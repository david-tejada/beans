import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CACHE = path.join(ROOT, ".theia-test");
const DOWNLOADS = "https://download.eclipse.org/theia/ide";

// Each release folder has electron-builder's update file for each OS, which
// names the version, the download and its sha512.
const PLATFORMS: Partial<Record<string, { folder: string; updateFile: string; extension: string }>> = {
	"linux-x64": { folder: "linux", updateFile: "latest-linux.yml", extension: ".AppImage" },
	"darwin-arm64": { folder: "macos-arm", updateFile: "latest-mac.yml", extension: ".zip" },
	"darwin-x64": { folder: "macos", updateFile: "latest-mac.yml", extension: ".zip" },
};

/**
 * The Theia IDE program to test: $THEIA_PATH (the app, or its executable)
 * if set, else a download of $THEIA_VERSION, "latest" by default, cached in
 * .theia-test/<version>. Linux gets the AppImage, unpacked so it needs no
 * FUSE; macOS, the zipped app.
 */
export async function theiaProgram(): Promise<string> {
	const installed = process.env.THEIA_PATH;
	if (installed) return executableIn(installed);

	const platform = PLATFORMS[`${process.platform}-${process.arch}`];
	if (!platform) throw new Error(`no Theia IDE download for ${process.platform}-${process.arch}; set THEIA_PATH`);
	const release = `${DOWNLOADS}/${process.env.THEIA_VERSION ?? "latest"}/${platform.folder}`;
	const update = await (await fetchOk(`${release}/${platform.updateFile}`)).text();
	const version = /^version: (\S+)$/m.exec(update)?.[1];
	const file = update
		.split("\n")
		.map((line) => /^\s+- url: (\S+)$/.exec(line)?.[1])
		.find((url) => url?.endsWith(platform.extension));
	const sha512 = file && new RegExp(`url: ${file.replace(/\./g, "\\.")}\\s+sha512: (\\S+)`).exec(update)?.[1];
	if (!version || !file || !sha512) throw new Error(`can't read ${release}/${platform.updateFile}`);

	const dir = path.join(CACHE, `${version}-${platform.folder}`);
	const app = process.platform === "darwin" ? path.join(dir, "TheiaIDE.app") : path.join(dir, "squashfs-root");
	if (!fs.existsSync(app)) {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.mkdirSync(dir, { recursive: true });
		const download = path.join(dir, file);
		await pipeline(Readable.fromWeb((await fetchOk(`${release}/${file}`)).body!), fs.createWriteStream(download));
		const hash = crypto.createHash("sha512").update(fs.readFileSync(download)).digest("base64");
		if (hash !== sha512) throw new Error(`${file} from ${release} doesn't match its sha512`);
		if (process.platform === "darwin") {
			execFileSync("ditto", ["-x", "-k", download, dir]);
		} else {
			fs.chmodSync(download, 0o755);
			// stderr goes into the error, should the AppImage fail to unpack.
			execFileSync(download, ["--appimage-extract"], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
		}
		fs.rmSync(download);
	}
	return executableIn(app);
}

/** The program to run in a Theia IDE app: the macOS bundle's executable, or the AppImage's AppRun. */
function executableIn(app: string): string {
	if (app.endsWith(".app")) return path.join(app, "Contents", "MacOS", "TheiaIDE");
	if (fs.statSync(app).isDirectory()) return path.join(app, "AppRun");
	return app;
}

async function fetchOk(url: string): Promise<Response> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
	return response;
}
