// Starts a VS Code for developing Beans: a separate instance (its own user
// data and extensions folders under .dev/) running this checkout as the
// extension, with the debug pipe held by the relay, so the hints work from
// the start without "Relaunch with hints". Rebuilds on every change and
// reloads the window when the extension host side changes; the extension
// re-injects the page script itself when that changes.
//
//   pnpm dev            start it, opening this repo as the workspace
//   pnpm dev <folder>   open another folder
//   BEANS_EDITOR=/path/to/Code pnpm dev   use that VS Code (or fork) binary
//
// Runs on Node 24's own TypeScript support, so it imports nothing from src/.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const devDir = path.join(root, ".dev");
const userDataDir = path.join(devDir, "user-data");
const extensionsDir = path.join(devDir, "extensions");
const relayFile = path.join(userDataDir, "beans-relay.json");
const workspace = path.resolve(process.argv[2] ?? root);
const INSPECT_PORT = 9229;

interface RelayAddress {
	address: string;
	token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readRelayFile(): RelayAddress {
	const value: unknown = JSON.parse(fs.readFileSync(relayFile, "utf8"));
	if (!isRecord(value) || typeof value.address !== "string" || typeof value.token !== "string") {
		throw new Error(`${relayFile} doesn't hold a relay address`);
	}
	return { address: value.address, token: value.token };
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});

async function main(): Promise<void> {
	const { cli, program } = findEditor();
	fs.mkdirSync(userDataDir, { recursive: true });
	fs.mkdirSync(extensionsDir, { recursive: true });
	// A second VS Code on the same user data folder hands its arguments to the
	// first and quits, and its relay would take the running one's relay file
	// with it. So one dev window at a time.
	if (await relayAnswers()) {
		throw new Error(
			"a dev VS Code is already running (its relay answers). Close that window first, then run this again.",
		);
	}
	installCommandServer(cli);

	console.log("[dev] building");
	run("pnpm", ["exec", "vp", "pack"]);
	const children: ChildProcess[] = [];
	const stop = () => {
		for (const child of children) child.kill();
		process.exit();
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);

	console.log("[dev] watching src/");
	children.push(spawn("pnpm", ["exec", "vp", "pack", "--watch"], { cwd: root, stdio: "inherit" }));

	// The relay starts the editor with the pipe and holds it; no pid to wait
	// for, so it starts at once. Not detached: closing the dev script closes
	// the pipe, and the editor with it.
	const job = {
		command: program,
		args: [
			"--remote-debugging-pipe",
			`--user-data-dir=${userDataDir}`,
			`--extensions-dir=${extensionsDir}`,
			`--extensionDevelopmentPath=${root}`,
			`--inspect-extensions=${INSPECT_PORT}`,
			"--disable-workspace-trust",
			workspace,
		],
		relayFile,
	};
	fs.rmSync(relayFile, { force: true });
	const relay = spawn(process.execPath, [path.join(root, "dist", "cdp-relay.js"), JSON.stringify(job)], {
		cwd: root,
		stdio: "inherit",
	});
	children.push(relay);
	relay.on("exit", (code) => {
		console.log(`[dev] VS Code closed${code ? ` (relay exit ${code})` : ""}`);
		stop();
	});
	console.log(`[dev] starting ${program}`);
	console.log(`[dev] extension host debugger on port ${INSPECT_PORT} (Attach to Extension Host in launch.json)`);
	await waitForFile(relayFile);

	// A new extension bundle or manifest (package.json: commands, settings) needs
	// a window reload, as Developer: Reload Window does; the page script and
	// stylesheet the extension picks up by itself.
	let timer: NodeJS.Timeout | undefined;
	for (const file of ["dist/extension.js", "dist/cdp-relay.js", "package.json"]) {
		fs.watchFile(path.join(root, file), { interval: 300 }, () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				console.log(`[dev] ${file} changed, reloading the window`);
				reloadWindows().catch((error: unknown) => console.error("[dev] reload failed:", error));
			}, 300);
		});
	}
}

/** The editor's CLI script (for installing extensions) and its main program (for the pipe). */
function findEditor(): { cli: string; program: string } {
	const override = process.env.BEANS_EDITOR;
	if (override) return { cli: override, program: override };
	const cli = whichCode();
	if (!cli) throw new Error("no `code` command on PATH; set BEANS_EDITOR to the editor's program");
	const real = fs.realpathSync(cli);
	if (process.platform === "darwin") {
		// The CLI is .../Visual Studio Code.app/Contents/Resources/app/bin/code; the
		// program is .../Contents/MacOS/Electron. `code` itself detaches, so it
		// can't pass the pipe.
		const bundle = real.indexOf(".app/");
		if (bundle === -1) throw new Error(`${real} isn't inside an .app bundle; set BEANS_EDITOR to the editor's program`);
		const app = real.slice(0, bundle + 4);
		const [program] = fs
			.readdirSync(path.join(app, "Contents", "MacOS"))
			.map((name) => path.join(app, "Contents/MacOS", name));
		if (!program) throw new Error(`no program in ${app}/Contents/MacOS`);
		return { cli, program };
	}
	if (process.platform === "win32") {
		// bin\code.cmd sits next to Code.exe's folder.
		const dir = path.dirname(path.dirname(real));
		const program = fs.readdirSync(dir).find((name) => name.toLowerCase().endsWith(".exe") && name !== "unins000.exe");
		if (!program) throw new Error(`no .exe in ${dir}`);
		return { cli, program: path.join(dir, program) };
	}
	// Linux: /usr/share/code/bin/code -> /usr/share/code/code, and the same shape for forks.
	const dir = path.dirname(path.dirname(real));
	const program = ["code", "code-insiders", "codium", "code-oss"]
		.map((name) => path.join(dir, name))
		.find((p) => fs.existsSync(p));
	if (!program) throw new Error(`no editor program in ${dir}; set BEANS_EDITOR`);
	return { cli, program };
}

function whichCode(): string | undefined {
	const names = process.platform === "win32" ? ["code.cmd", "code"] : ["code", "code-insiders", "codium"];
	for (const name of names) {
		try {
			return execFileSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" })
				.split(/\r?\n/)[0]
				?.trim();
		} catch {}
	}
	return undefined;
}

/** Installs command-server into the dev extensions folder once, so Talon can reach the dev window. */
function installCommandServer(cli: string): void {
	const installed = fs.readdirSync(extensionsDir).some((name) => name.startsWith("pokey.command-server-"));
	if (installed) return;
	console.log("[dev] installing pokey.command-server into .dev/extensions");
	run(cli, [
		`--extensions-dir=${extensionsDir}`,
		`--user-data-dir=${userDataDir}`,
		"--install-extension",
		"pokey.command-server",
	]);
}

function run(command: string, args: string[]): void {
	execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function waitForFile(file: string): Promise<void> {
	return new Promise((resolve) => {
		const timer = setInterval(() => {
			if (fs.existsSync(file)) {
				clearInterval(timer);
				resolve();
			}
		}, 200);
	});
}

/** Whether a relay is listening at the address in the relay file. */
async function relayAnswers(): Promise<boolean> {
	if (!fs.existsSync(relayFile)) return false;
	try {
		const { address } = readRelayFile();
		await new Promise<void>((resolve, reject) => {
			const socket = net.connect(address);
			socket.once("connect", () => {
				socket.end();
				resolve();
			});
			socket.once("error", reject);
		});
		return true;
	} catch {
		return false;
	}
}

/** Reloads every VS Code window through the relay, as Developer: Reload Window does. */
async function reloadWindows(): Promise<void> {
	const { address, token } = readRelayFile();
	const socket = net.connect(address);
	await new Promise<void>((resolve, reject) => {
		socket.once("connect", resolve);
		socket.once("error", reject);
	});
	socket.write(`${token}\0`);
	let nextId = 0;
	const pending = new Map<number, (message: Record<string, unknown>) => void>();
	let buffer = "";
	socket.setEncoding("utf8");
	socket.on("data", (chunk: string) => {
		buffer += chunk;
		let end;
		while ((end = buffer.indexOf("\0")) >= 0) {
			const message: unknown = JSON.parse(buffer.slice(0, end));
			buffer = buffer.slice(end + 1);
			if (isRecord(message) && typeof message.id === "number") pending.get(message.id)?.(message);
		}
	});
	const send = <T,>(method: string, params: object = {}, sessionId?: string) =>
		new Promise<T>((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, (message) => {
				pending.delete(id);
				const error = message.error;
				if (isRecord(error)) reject(new Error(String(error.message)));
				// A CDP result has the shape its method documents; the caller names it.
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion
				else resolve(message.result as T);
			});
			socket.write(`${JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) })}\0`);
		});
	try {
		const { targetInfos } = await send<{ targetInfos: { targetId: string; type: string; url: string }[] }>(
			"Target.getTargets",
		);
		for (const page of targetInfos.filter((t) => t.type === "page" && t.url.startsWith("vscode-file://"))) {
			const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", {
				targetId: page.targetId,
				flatten: true,
			});
			await send("Page.reload", {}, sessionId);
		}
	} finally {
		socket.end();
	}
}
