import path from "path";
import { ChildProcess, spawn } from "child_process";
import { log } from "../models/logger.js";
import { IDefinition } from "./definitions.js";

const GitTimeoutMs = 5000;

export interface IPermalinkSource {
    forDefinition(definition: IDefinition): Promise<string>;
}

interface IRepo {
    root: string;
    // the https base of the github repo, null where the remote is not one barky can build a link to
    base: string;
}

interface IGitResult {
    // null when git could not be run at all, so "it failed" and "it printed nothing" stay apart
    output: string;
}

// the root and the remote of a checkout do not change while barky runs, so they are read once
const _repos = new Map<string, IRepo>();
let _reportedMissingGit = false;

export function resetPermalinks() {
    _repos.clear();
    _reportedMissingGit = false;
}

/*
 A github link to the block a definition came from, for the ones too long to post into slack.

 The link names the commit rather than a branch, so it keeps pointing at the lines barky actually
 read. That is also why a commit no remote has yet gets no link at all: the url would 404, which is
 worse than saying nothing. Returns null whenever a link cannot be built - no git on the path, not
 a checkout, a remote that is not github - and never throws, because this is decoration on an
 answer barky has already worked out.
 */
export class GitPermalinkSource implements IPermalinkSource {

    public async forDefinition(definition: IDefinition): Promise<string> {
        try {
            return await buildPermalink(definition);
        } catch (err) {
            log(`chatops: could not build a permalink for ${ definition?.displayPath }: ${ err }`, err);
            return null;
        }
    }
}

async function buildPermalink(definition: IDefinition): Promise<string> {
    if (!definition?.filePath) {
        return null;
    }
    const dir = path.dirname(definition.filePath);
    const repo = await repoFor(dir);
    if (!repo?.base) {
        return null;
    }
    const relative = await pathWithinRepo(dir, definition.filePath);
    if (!relative) {
        return null;
    }
    const sha = await git(repo.root, ["rev-parse", "HEAD"]);
    if (!sha.output) {
        return null;
    }
    const onRemote = await git(repo.root, ["branch", "-r", "--contains", sha.output]);
    if (!onRemote.output) {
        // the commit barky is running is on no remote branch, so nothing on github can show it
        return null;
    }
    return [
        repo.base,
        "/blob/",
        sha.output,
        "/",
        relative.split("/").map(encodeURIComponent).join("/"),
        await anchorFor(repo, relative, definition)
    ].join("");
}

/*
 Git is asked where the file sits in the repository rather than being worked out from the two
 paths: a symlink anywhere above the config file - a deploy directory pointing at a release, or
 /var on a mac - makes the arithmetic come out wrong. It also answers for a file git is not
 tracking, which has no page on github to link to.
 */
async function pathWithinRepo(dir: string, filePath: string): Promise<string> {
    const tracked = await git(
        dir,
        ["ls-files", "--full-name", "--error-unmatch", "--", path.basename(filePath)]);
    return tracked.output
        ? tracked.output.split("\n")[0].trim()
        : null;
}

/*
 Line numbers only hold where the working copy agrees with the commit being linked to. Where the
 file has uncommitted changes the link still names the file, without pointing at lines that may
 have moved.
 */
async function anchorFor(repo: IRepo, relative: string, definition: IDefinition): Promise<string> {
    const changed = await git(repo.root, ["status", "--porcelain", "--", relative]);
    const modified = changed.output === null || changed.output.length > 0;
    return modified
        ? ""
        : `#L${ definition.firstLine }-L${ definition.lastLine }`;
}

async function repoFor(dir: string): Promise<IRepo> {
    if (_repos.has(dir)) {
        return _repos.get(dir);
    }
    const repo = await readRepo(dir);
    _repos.set(dir, repo);
    return repo;
}

async function readRepo(dir: string): Promise<IRepo> {
    const root = await git(dir, ["rev-parse", "--show-toplevel"]);
    if (!root.output) {
        return null;
    }
    const remote = await git(root.output, ["config", "--get", "remote.origin.url"]);
    const base = githubBaseFor(remote.output);
    if (!base) {
        log(`chatops: ${ root.output } has no github remote barky recognises, so a definition too long for slack will not carry a link to the rest of it`);
    }
    return { root: root.output, base };
}

/*
 Accepts the forms git writes into a remote - "git@github.com:owner/repo.git",
 "https://github.com/owner/repo.git", "ssh://git@github.com/owner/repo" - and nothing else. Another
 host means no link rather than a wrong one.
 */
export function githubBaseFor(remote: string): string {
    const normalised = (remote ?? "")
        .trim()
        .replace(/^ssh:\/\//i, "")
        .replace(/^https?:\/\//i, "")
        .replace(/^[^@\/]+@/, "")
        .replace(/\.git$/i, "")
        .replace(/\/+$/, "");
    const match = /^github\.com[:\/](.+)$/i.exec(normalised);
    if (!match) {
        return null;
    }
    const repoPath = match[1].replace(/^\/+/, "");
    return /^[^\/]+\/[^\/]+$/.test(repoPath)
        ? `https://github.com/${ repoPath }`
        : null;
}

async function git(dir: string, args: string[]): Promise<IGitResult> {
    const result = await run("git", ["-C", dir, ...args]);
    return {
        output: result.exitCode === 0 ? result.stdout.trim() : null
    };
}

function run(command: string, args: string[]): Promise<{ exitCode: number, stdout: string }> {
    return new Promise(resolve => {
        let settled = false;
        let timer = null;
        const finish = (exitCode: number, stdout: string) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve({ exitCode, stdout });
        };
        const worker = start(command, args);
        if (!worker) {
            return finish(-1, "");
        }
        timer = setTimeout(() => {
            worker.kill("SIGKILL");
            finish(-1, "");
        }, GitTimeoutMs);
        const output = [];
        worker.stdout.on("data", x => output.push(x));
        // read and dropped - git writes its complaints here, and the exit code is what barky acts on
        worker.stderr.on("data", () => undefined);
        /*
         Without this, a machine with no git on the path emits an error event nothing is listening
         for, which node turns into an uncaught exception - and takes the whole watchdog down over a
         link in a slack message.
         */
        worker.on("error", err => {
            reportMissingGit(err);
            finish(-1, "");
        });
        worker.on("close", code => finish(code ?? -1, output.join("").trim()));
    });
}

function start(command: string, args: string[]): ChildProcess {
    try {
        return spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
        // spawn throws before the process exists only where node cannot build the argument list.
        // The caller reads that the same way as git exiting non-zero: no link, and nothing else
        // affected
        log(`chatops: could not run ${ command }: ${ err }`, err);
        return null;
    }
}

function reportMissingGit(err: any): void {
    if (_reportedMissingGit || err?.code !== "ENOENT") {
        return;
    }
    _reportedMissingGit = true;
    log("chatops: git is not on the path, so a definition too long for slack will not carry a link to the rest of it");
}
