/**
 * /toggle — interactive on/off chart for pi packages, skills, and extensions.
 *
 * Ports the original pi-toggle.py prototype into a native pi TUI overlay:
 *   ↑↓/j/k move · space toggle · enter apply · r revert · esc/q cancel
 * After applying, run /reload (or restart pi) for changes to take effect.
 *
 * Install: ~/.pi/agent/extensions/toggle.ts (then /reload)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const getAgentDir = () => join(homedir(), ".pi", "agent");

type Kind = "package" | "skill" | "extension";
type Item = { kind: Kind; name: string; on: boolean };

function readSettings(agentDir: string): { packages?: string[] } & Record<string, unknown> {
	return JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
}

const KIND_ORDER: Record<Kind, number> = { package: 0, skill: 1, extension: 2 };

export function discover(): Item[] {
	const agentDir = getAgentDir();
	const items: Item[] = [];

	// packages: on iff listed in settings.json; off candidates = installed pkgs with a "pi" field
	const settings = readSettings(agentDir);
	const pkgs = settings.packages ?? [];
	for (const p of pkgs) items.push({ kind: "package", name: p, on: true });
	const npmDir = join(agentDir, "npm", "node_modules");
	if (existsSync(npmDir)) {
		for (const scope of readdirSync(npmDir).sort()) {
			const scopeDir = join(npmDir, scope);
			if (!existsSync(scopeDir)) continue;
			const candidates = scope.startsWith("@")
				? readdirSync(scopeDir).sort().map((n) => ({ dir: join(scopeDir, n), name: `npm:${scope}/${n}` }))
				: [{ dir: scopeDir, name: `npm:${scope}` }];
			for (const { dir, name } of candidates) {
				if (scope === "pi-coding-agent" || name === `npm:${scope}`.replace("npm:npm:", "npm:")) continue;
				try {
					if (!("pi" in JSON.parse(readFileSync(join(dir, "package.json"), "utf8")))) continue;
				} catch {
					continue;
				}
				if (!pkgs.includes(name)) items.push({ kind: "package", name, on: false });
			}
		}
	}

	// skills: on iff in skills/, off iff in skills-disabled/
	const pair = (onDir: string, offDir: string, kind: Kind): Item[] => {
		const names = new Set<string>();
		try {
			for (const n of readdirSync(onDir)) if (!n.startsWith(".")) names.add(n);
		} catch {}
		try {
			for (const n of readdirSync(offDir)) if (!n.startsWith(".")) names.add(n);
		} catch {}
		return [...names].sort().map((name) => ({ kind, name, on: existsSync(join(onDir, name)) }));
	};
	items.push(...pair(join(agentDir, "skills"), join(agentDir, "skills-disabled"), "skill"));

	// extensions: on iff in extensions/, off iff in extensions-disabled/; dirs need an entry point
	const extDir = join(agentDir, "extensions");
	const extOff = join(agentDir, "extensions-disabled");
	const extNames = new Set<string>();
	for (const base of [extDir, extOff]) {
		try {
			for (const n of readdirSync(base)) {
				if (n.startsWith(".") || n === "node_modules" || n === "node_modules_tmp") continue;
				extNames.add(n);
			}
		} catch {}
	}
	for (const name of [...extNames].sort()) {
		const src = join(extDir, name);
		if (!existsSync(src)) {
			items.push({ kind: "extension", name, on: false });
			continue;
		}
		// dirs are only loadable (and toggleable) with an entry point; skip the rest
		let isDir = false;
		try {
			readdirSync(src);
			isDir = true;
		} catch {}
		if (isDir) {
			const hasEntry =
				existsSync(join(src, "index.ts")) ||
				existsSync(join(src, "index.js")) ||
				existsSync(join(src, "package.json"));
			if (!hasEntry) continue;
		}
		items.push({ kind: "extension", name, on: true });
	}
	// grouped by kind, alphabetized within each group
	return items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
}

export function apply(items: Item[], agentDir: string): string[] {
	const log: string[] = [];
	for (const { kind, name, on } of items) {
		if (kind === "package") {
			const settings = readSettings(agentDir);
			const pkgs = settings.packages ?? (settings.packages = []);
			const changed = on ? !pkgs.includes(name) : pkgs.includes(name);
			if (!changed) continue;
			if (on) pkgs.push(name);
			else pkgs.splice(pkgs.indexOf(name), 1);
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
		} else {
			// `on` is the target state: enabling moves out of the -disabled dir, disabling moves into it
			const onDir = join(agentDir, kind === "skill" ? "skills" : "extensions");
			const offDir = join(agentDir, kind === "skill" ? "skills-disabled" : "extensions-disabled");
			const src = join(on ? offDir : onDir, name);
			const dst = join(on ? onDir : offDir, name);
			if (!existsSync(src) || existsSync(dst)) continue;
			mkdirSync(dirname(dst), { recursive: true });
			renameSync(src, dst);
		}
		log.push(`${kind} ${name} -> ${on ? "on" : "off"}`);
	}
	return log;
}

export default function toggleExtension(pi: ExtensionAPI) {
	pi.registerCommand("toggle", {
		description: "Toggle packages, skills, and extensions on/off (apply, then /reload)",
		handler: async (_args, ctx: ExtensionContext) => {
			const agentDir = getAgentDir();
			let items = discover();
			let sel = 0;
			let scroll = 0;

			const result = await ctx.ui.custom<string[] | null>((tui, theme, _kb, done) => {
				return {
					render(width: number) {
						const rows: string[] = [];
						const groupLabel: Record<Kind, string> = { package: "packages", skill: "skills", extension: "extensions" };
						let lastKind: Kind | null = null;
						let selRow = 0;
						items.forEach((it, i) => {
							if (it.kind !== lastKind) {
								if (lastKind !== null) rows.push("");
								rows.push(theme.fg("accent", theme.bold(groupLabel[it.kind])));
								lastKind = it.kind;
							}
							const box = it.on ? theme.fg("success", "[x]") : theme.fg("muted", "[ ]");
							let line = ` ${box} ${it.name}`;
							if (line.length > width - 1) line = line.slice(0, width - 1);
							if (i === sel) {
								line = theme.fg("accent", `> ${line}`);
								selRow = rows.length;
							}
							rows.push(line);
						});
						const MAX = Math.min(12, rows.length);
						if (selRow < scroll) scroll = selRow;
						else if (selRow >= scroll + MAX) scroll = selRow - MAX + 1;
						scroll = Math.max(0, Math.min(scroll, rows.length - MAX));
						const lines: string[] = [theme.fg("accent", theme.bold("pi-toggle")), ""];
						if (scroll > 0) lines.push(theme.fg("dim", `  ↑ ${scroll} more`));
						lines.push(...rows.slice(scroll, scroll + MAX));
						if (scroll + MAX < rows.length) lines.push(theme.fg("dim", `  ↓ ${rows.length - scroll - MAX} more`));
						lines.push("");
						lines.push(theme.fg("dim", "↑↓/jk move · space toggle · enter apply · r revert · esc cancel"));
						return lines;
					},
					invalidate() {},
					handleInput(data: string) {
						if (data === "\x1b[A" || data === "k") sel = Math.max(0, sel - 1);
						else if (data === "\x1b[B" || data === "j") sel = Math.min(items.length - 1, sel + 1);
						else if (data === " ") items[sel].on = !items[sel].on;
						else if (data === "r") {
							items = discover();
							sel = 0;
							scroll = 0;
						} else if (data === "\r" || data === "\n") {
							done(apply(items, agentDir));
							return;
						} else if (data === "\x1b" || data === "q") {
							done(null);
							return;
						}
						tui.requestRender();
					},
				};
			});

			if (result === null) {
				ctx.ui.notify("pi-toggle: cancelled, nothing changed", "info");
			} else if (result.length === 0) {
				ctx.ui.notify("pi-toggle: nothing to change", "info");
			} else {
				ctx.ui.notify(`pi-toggle applied: ${result.join("; ")}. Run /reload to take effect.`, "info");
			}
		},
	});
}
