import fs from "fs";
import path from "path";
import YAML from "yaml";
import { AppVariant } from "../models/app.js";
import { EvaluatorType } from "../evaluators/base.js";
import { explodeUniqueKey, IUniqueKey } from "../lib/key.js";
import { log } from "../models/logger.js";

/*
 Where an alert comes from: the yaml block that declares it, verbatim from the file it was read out
 of. Read back from the file rather than re-serialised from the loaded config, because the loaded
 config carries injected keys (name, type, timeout, __configPath) and has lost every comment.
 */
export interface IDefinition {
    alertId: string;
    // the config key that declares it, which is not the alert's own label where vary-by is used
    key: string;
    type: string;
    filePath: string;
    displayPath: string;
    yaml: string;
    firstLine: number;
    lastLine: number;
    // the vary-by instance this particular alert is, where the check varies
    variation?: string;
    redacted: number;
    // the check this id is the monitor for, when the id names the monitor rather than the check
    monitorFor?: string;
}

export interface IDefinitionSource {
    find(alertId: string): IDefinition;
}

// the rules configuration, read afresh on every call - barky reloads it every pass, so a config
// edited while it is running must not answer out of a copy taken at startup
export type RulesProvider = () => any;

interface IIndexedApp {
    key: string;
    app: any;
    variation: string;
}

interface IDefinitionMatch {
    alertId: string;
    key: IUniqueKey;
    found: IIndexedApp;
    // the check this id is the monitor for, null where the id names the check itself
    monitorFor: string;
}

/*
 Keys whose value is worth hiding. Barky's own convention is that these name an environment
 variable rather than holding a secret - "token: sumo-token" is a lookup key - so a value that
 reads as a variable name is shown, and anything else is not.
 */
const SensitiveKeyRegex = /(?:^|[-_.])(?:password|passwd|pwd|secret|token|auth|authorization|credential|credentials|api-?key|access-?key|private-?key|key)(?:$|[-_.])/i;

// "$whatsapp-bot-token-za", "sumo-token", "SUMO_TOKEN" - one case throughout, separated by dashes,
// underscores or dots. A long unseparated run of characters is not a name someone chose to type
const EnvVarReferenceRegex = /^\$?(?:[a-z0-9]+(?:[-_.][a-z0-9]+)*|[A-Z0-9]+(?:[-_.][A-Z0-9]+)*)$/;
const MaxReferenceLength = 64;
const MaxBareReferenceLength = 16;

const KeyValueRegex = /^(\s*-?\s*)(['"]?)([A-Za-z0-9_.\-]+)\2(\s*:\s*)(\S.*)$/;
// a pair inside an inline flow map - "headers: { Authorization: abc }"
const InlinePairRegex = /^(\s*)(['"]?)([A-Za-z0-9_.\-]+)\2(\s*:\s*)(\S.*)$/;
const InlineMapRegex = /\{([^{}]*)\}/g;

const Redacted = "***redacted***";

export const MonitorLabel = "monitor";

/*
 Resolves an alert id to the block of yaml that declares it.

 Alert ids are type::label::identifier, and where the check name sits within that is per evaluator:
 mysql, sumo and shell put it in the label, web puts it in the identifier, and the monitor row any
 evaluator can emit puts it in the identifier too. Both are tried, label first.
 */
export class ConfigDefinitionSource implements IDefinitionSource {

    constructor(private readonly rules: RulesProvider) {
    }

    public find(alertId: string): IDefinition {
        const key = explodeUniqueKey(alertId);
        if (!key?.type || (!key.label && !key.identifier)) {
            return null;
        }
        const index = buildIndex(this.rules());
        const byLabel = index.get(indexKey(key.type, key.label));
        const found = byLabel ?? index.get(indexKey(key.type, key.identifier));
        if (!found) {
            return null;
        }
        return describe({
            alertId,
            key,
            found,
            monitorFor: !byLabel && key.label === MonitorLabel
                ? (found.app.name ?? found.key)
                : null
        });
    }
}

function describe(match: IDefinitionMatch): IDefinition {
    const { alertId, key, found } = match;
    const filePath = found.app.__configPath;
    if (!filePath || !fs.existsSync(filePath)) {
        // the check is in the configuration barky is running, but the file that declared it
        // cannot be read. Logged because the caller is only told the definition was not found,
        // which reads as though the check itself were gone
        log(`chatops: ${ alertId } is declared by '${ found.key }', but its source could not be read: ${ filePath ?? "no path recorded" }`);
        return null;
    }
    const source = fs.readFileSync(filePath, "utf8");
    const block = findBlock(source, key.type, found.key);
    if (!block) {
        return null;
    }
    return {
        alertId,
        key: found.key,
        type: key.type,
        filePath,
        displayPath: describePath(filePath),
        yaml: block.yaml,
        firstLine: block.firstLine,
        lastLine: block.lastLine,
        variation: found.variation,
        redacted: block.redacted,
        monitorFor: match.monitorFor
    };
}

/*
 Every check the configuration declares, keyed by the name its alerts are reported under. A check
 using vary-by is reported under each of its variations, so comms.engine.za finds the block that
 declares comms.engine.$1.
 */
function buildIndex(rules: any): Map<string, IIndexedApp> {
    const index = new Map<string, IIndexedApp>();
    Object.keys(EvaluatorType).forEach(type => {
        const apps = rules?.[type];
        if (!apps || typeof apps !== "object") {
            return;
        }
        Object.keys(apps).forEach(key => {
            const app = apps[key];
            if (!app || typeof app !== "object" || Array.isArray(app)) {
                return;
            }
            namesFor(app, key).forEach(x => {
                // the first name wins, so a check cannot be masked by a later one varying onto the
                // same name
                if (!index.has(indexKey(type, x.name))) {
                    index.set(indexKey(type, x.name), { key, app, variation: x.variation });
                }
            });
        });
    });
    return index;
}

function namesFor(app: any, key: string): { name: string, variation: string }[] {
    // the loaded config only carries a name once an evaluation pass has defaulted it, so it is
    // defaulted here too rather than relying on that having happened
    const name = app.name ?? key;
    const variations = app["vary-by"]?.length > 0 ? app["vary-by"] : [null];
    return variations.map(instance => ({
        name: new AppVariant({ ...app, name }, instance).name ?? name,
        variation: instance === null || instance === undefined
            ? null
            : [instance].flat().join(",")
    }));
}

function indexKey(type: string, name: string): string {
    return `${ type }::${ name }`;
}

/*
 Slices the source of one check's block out of its file. The key line is included and the block is
 dedented, so what comes back reads as a standalone definition rather than something lifted out of
 the middle of a larger map.
 */
function findBlock(
    source: string,
    type: string,
    key: string): { yaml: string, firstLine: number, lastLine: number, redacted: number } {
    const pair = findPair(source, type, key);
    if (!pair) {
        return null;
    }
    const keyRange = pair.key?.range;
    if (!keyRange) {
        return null;
    }
    const start = source.lastIndexOf("\n", keyRange[0]) + 1;
    // range[1] is the end of the value itself - range[2] would reach into the whitespace and
    // comments that follow it, which belong to whatever comes next
    const end = pair.value?.range?.[1] ?? keyRange[1];
    const raw = source.substring(start, end).replace(/\s+$/, "");
    if (!raw) {
        return null;
    }
    const lines = raw.split("\n");
    const redaction = redact(dedent(lines));
    const firstLine = countLinesTo(source, start);
    return {
        yaml: redaction.lines.join("\n"),
        firstLine,
        lastLine: firstLine + lines.length - 1,
        redacted: redaction.redacted
    };
}

function findPair(source: string, type: string, key: string): any {
    const root = YAML.parseDocument(source)?.contents;
    if (!YAML.isMap(root)) {
        return null;
    }
    let found = null;
    root.items
        .filter(item => scalarOf(item.key) === type)
        .map(item => item.value)
        .filter(value => YAML.isMap(value))
        .forEach((map: any) => {
            // a file declaring the same evaluator block twice is parsed with the last one winning,
            // so the source read back has to agree with the configuration barky is running
            map.items
                .filter(item => scalarOf(item.key) === key)
                .forEach(item => found = item);
        });
    return found;
}

function scalarOf(node: any): string {
    return node?.value !== undefined && node?.value !== null
        ? String(node.value)
        : null;
}

function countLinesTo(source: string, offset: number): number {
    let lines = 1;
    for (let i = 0; i < offset; i++) {
        if (source[i] === "\n") {
            lines++;
        }
    }
    return lines;
}

function dedent(lines: string[]): string[] {
    const indents = lines
        .filter(x => x.trim().length > 0)
        .map(x => /^[ \t]*/.exec(x)[0].length);
    const shortest = indents.length > 0 ? Math.min(...indents) : 0;
    return shortest === 0
        ? lines
        : lines.map(x => x.substring(shortest));
}

/*
 Hides anything that looks like a literal secret. Barky's configuration names environment variables
 rather than holding their values, so this rarely has anything to do - but a url or a header can
 carry one inline, and the channel this is posted into is wider than the box barky runs on.
 */
function redact(lines: string[]): { lines: string[], redacted: number } {
    let redacted = 0;
    const safe = lines.map(line => {
        const rewritten = redactLine(line);
        if (rewritten !== line) {
            redacted++;
        }
        return rewritten;
    });
    return { lines: safe, redacted };
}

function redactLine(line: string): string {
    const match = KeyValueRegex.exec(line);
    if (match && isSensitive(match[3]) && !isEnvVarReference(match[5])) {
        // the whole remainder goes, trailing comment and all - a comment on a secret is not worth
        // the risk of splitting the line in the wrong place
        return `${ match[1] }${ match[2] }${ match[3] }${ match[2] }${ match[4] }${ Redacted }`;
    }
    return line.includes("{")
        ? redactInlinePairs(line)
        : line;
}

function redactInlinePairs(line: string): string {
    return line.replace(
        InlineMapRegex,
        (_whole, body) => `{${ splitOutsideQuotes(body).map(redactInlinePair).join(",") }}`);
}

function redactInlinePair(part: string): string {
    const match = InlinePairRegex.exec(part);
    return match && isSensitive(match[3]) && !isEnvVarReference(match[5])
        ? `${ match[1] }${ match[2] }${ match[3] }${ match[2] }${ match[4] }${ Redacted }`
        : part;
}

/*
 Splits an inline map on the commas separating its pairs, leaving alone any inside a quoted value -
 splitting on one of those would cut a secret in half and redact only the first piece of it.
 */
function splitOutsideQuotes(body: string): string[] {
    const parts = [];
    let current = "";
    let quote = null;
    for (const character of body) {
        if (quote) {
            current += character;
            quote = character === quote ? null : quote;
            continue;
        }
        if (character === "'" || character === "\"") {
            quote = character;
            current += character;
            continue;
        }
        if (character === ",") {
            parts.push(current);
            current = "";
            continue;
        }
        current += character;
    }
    parts.push(current);
    return parts;
}

function isSensitive(key: string): boolean {
    return SensitiveKeyRegex.test(key ?? "");
}

/*
 Reads as the name of an environment variable rather than as a value: one case throughout, and
 short enough to be something a person typed. A long unbroken run of characters is a secret however
 it is cased. The $ form says outright that it is a reference, so length is all that guards it;
 without the $ there is nothing but shape to go on, and "prod-db-password-2024" is as plausible a
 passphrase as it is a variable name - so a bare value has to be short and read as a separated name
 before it is let through.
 */
function isEnvVarReference(value: string): boolean {
    const candidate = (value ?? "").replace(/\s+#.*$/, "").trim().replace(/^['"]|['"]$/g, "");
    if (!candidate || !EnvVarReferenceRegex.test(candidate)) {
        return false;
    }
    return candidate.startsWith("$")
        ? candidate.length <= MaxReferenceLength
        : /[-_.]/.test(candidate) && candidate.length <= MaxBareReferenceLength;
}

function describePath(filePath: string): string {
    const relative = path.relative(process.cwd(), filePath);
    return relative && !relative.startsWith("..")
        ? relative
        : filePath;
}
