import { defineConfig } from "vite-plus";

export default defineConfig({
	// vp pack bundles with tsdown. Two targets: the extension host side
	// (CommonJS, which VS Code's extension host loads; cdp-relay is its own
	// bundle because relaunch.ts spawns it as a separate Node process) and
	// the hint script, one plain script that inject.ts embeds in the page.
	pack: [
		{
			entry: { extension: "src/extension.ts" },
			format: "cjs",
			platform: "node",
			target: "node20",
			deps: { neverBundle: ["vscode"] },
			outDir: "dist",
			outExtensions: () => ({ js: ".js" }),
			sourcemap: true,
			dts: false,
			clean: false,
		},
		{
			// Its own bundle, with nothing shared, since it runs as a separate process.
			entry: { "cdp-relay": "src/cdp-relay.ts" },
			format: "cjs",
			platform: "node",
			target: "node20",
			outDir: "dist",
			outExtensions: () => ({ js: ".js" }),
			sourcemap: true,
			dts: false,
			clean: false,
		},
		{
			entry: { beans: "src/page/main.ts" },
			format: "iife",
			platform: "browser",
			target: "es2022",
			outDir: "dist",
			outputOptions: { entryFileNames: "[name].js" },
			sourcemap: false,
			dts: false,
			minify: false,
			clean: false,
		},
	],
	fmt: {
		useTabs: true,
		printWidth: 120,
		ignorePatterns: ["dist/**", ".dev/**", "beans-talon/**", "src/types/git.d.ts"],
	},
	lint: {
		ignorePatterns: ["dist/**", ".dev/**", "beans-talon/**", "src/types/git.d.ts"],
		options: { typeAware: true, typeCheck: true },
		// correctness is on by default. suspicious catches likely mistakes (an
		// unsafe `as`, a shadowed name); perf, slower ways of writing a thing.
		categories: { suspicious: "error", perf: "error" },
		plugins: ["typescript", "unicorn", "oxc", "promise", "import", "vitest"],
		rules: {
			// Beans runs VS Code commands one after another on purpose: each
			// changes what the next one sees.
			"no-await-in-loop": "off",
			// The hint script's globals on window are prefixed on purpose, to clash with nothing.
			"no-underscore-dangle": ["error", { allow: ["__beans", "__beansChannelId", "__beansStop", "__beansVersion"] }],
		},
	},
	test: {
		projects: [
			{ test: { name: "unit", include: ["test/*.test.ts"] } },
			// Downloads and drives a real VS Code: pnpm test:integration.
			{
				test: {
					name: "integration",
					include: ["test/integration/*.test.ts"],
					// Longer than a waitFor, so a wait that gives up says what it waited for.
					testTimeout: 90_000,
					hookTimeout: 300_000,
					fileParallelism: false,
				},
			},
		],
	},
	staged: {
		"*.{ts,json,md,yml,yaml,css}": "vp check --fix",
	},
});
