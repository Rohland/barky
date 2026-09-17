import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import mockConsole from "jest-mock-console";
import { GitPermalinkSource, githubBaseFor, resetPermalinks } from "./permalink.js";
import { IDefinition } from "./definitions.js";

// every one of these needs git on the path, which is the condition the feature itself is under
const hasGit = spawnSync("git", ["--version"]).status === 0;
const describeWithGit = hasGit ? describe : describe.skip;

describe("chatops permalink", () => {

    let restoreConsole;
    const temporaryDirs: string[] = [];

    beforeEach(() => {
        restoreConsole = mockConsole();
        resetPermalinks();
    });

    afterEach(() => {
        temporaryDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
        temporaryDirs.length = 0;
        restoreConsole();
    });

    describe("githubBaseFor", () => {
        describe.each([
            ["git@github.com:Rohland/barky.git", "https://github.com/Rohland/barky"],
            ["git@github.com:Rohland/barky", "https://github.com/Rohland/barky"],
            ["https://github.com/Rohland/barky.git", "https://github.com/Rohland/barky"],
            ["https://github.com/Rohland/barky", "https://github.com/Rohland/barky"],
            ["https://someone@github.com/Rohland/barky.git", "https://github.com/Rohland/barky"],
            ["ssh://git@github.com/Rohland/barky.git", "https://github.com/Rohland/barky"],
            ["https://github.com/Rohland/barky/", "https://github.com/Rohland/barky"],
            ["GIT@GITHUB.COM:Rohland/barky.git", "https://github.com/Rohland/barky"]
        ])("given '%s'", (remote, expected) => {
            it("should read the repository out of it", async () => {
                expect(githubBaseFor(remote)).toEqual(expected);
            });
        });
        describe.each([
            ["a gitlab remote", "git@gitlab.com:Rohland/barky.git"],
            ["a self hosted remote", "git@git.example.com:Rohland/barky.git"],
            ["a local path", "/srv/git/barky.git"],
            ["a repository with no owner", "git@github.com:barky.git"],
            ["nothing", ""],
            ["null", null]
        ])("given %s", (_label, remote) => {
            it("should return null rather than a link that goes nowhere", async () => {
                expect(githubBaseFor(remote)).toBeNull();
            });
        });
    });

    describeWithGit("forDefinition", () => {

        function makeRepo(options: { remote?: string, push?: boolean } = {}): string {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "barky-permalink-"));
            temporaryDirs.push(root);
            const git = (...args: string[]) => {
                const result = spawnSync("git", ["-C", root, ...args]);
                if (result.status !== 0) {
                    throw new Error(`git ${ args.join(" ") } failed: ${ result.stderr }`);
                }
            };
            git("init", "-q", "-b", "main");
            git("config", "user.email", "test@example.com");
            git("config", "user.name", "test");
            git("config", "commit.gpgsign", "false");
            fs.mkdirSync(path.join(root, "configs"));
            fs.writeFileSync(path.join(root, "configs", "rules.yaml"), "web:\n  a:\n    url: https://a\n");
            if (options.remote !== null) {
                git("remote", "add", "origin", options.remote ?? "git@github.com:acme/widgets.git");
            }
            git("add", ".");
            git("commit", "-q", "-m", "rules");
            if (options.push !== false) {
                // the ref a push would have created, without needing anywhere to push to
                git("update-ref", "refs/remotes/origin/main", "HEAD");
            }
            return root;
        }

        function definitionIn(root: string): IDefinition {
            return {
                alertId: "web::health::a",
                key: "a",
                type: "web",
                filePath: path.join(root, "configs", "rules.yaml"),
                displayPath: "configs/rules.yaml",
                yaml: "a:\n  url: https://a",
                firstLine: 2,
                lastLine: 3,
                redacted: 0
            };
        }

        function shaOf(root: string): string {
            return spawnSync("git", ["-C", root, "rev-parse", "HEAD"]).stdout.toString().trim();
        }

        it("should link to the committed lines the block was read from", async () => {
            // arrange
            const root = makeRepo();

            // act
            const link = await new GitPermalinkSource().forDefinition(definitionIn(root));

            // assert - the commit, not a branch, so it keeps pointing at these lines
            expect(link).toEqual(
                `https://github.com/acme/widgets/blob/${ shaOf(root) }/configs/rules.yaml#L2-L3`);
        });

        it("should not point at lines that may have moved", async () => {
            // arrange - the working copy no longer matches the commit being linked to
            const root = makeRepo();
            fs.writeFileSync(
                path.join(root, "configs", "rules.yaml"),
                "web:\n  inserted:\n    url: https://inserted\n  a:\n    url: https://a\n");

            // act
            const link = await new GitPermalinkSource().forDefinition(definitionIn(root));

            // assert
            expect(link).toEqual(
                `https://github.com/acme/widgets/blob/${ shaOf(root) }/configs/rules.yaml`);
        });

        it("should return nothing for a file git is not tracking", async () => {
            // arrange - an uncommitted config file has no page on github to point at
            const root = makeRepo();
            fs.writeFileSync(path.join(root, "configs", "extra.yaml"), "web:\n  b:\n    url: https://b\n");

            // act
            const link = await new GitPermalinkSource().forDefinition({
                ...definitionIn(root),
                filePath: path.join(root, "configs", "extra.yaml")
            });

            // assert
            expect(link).toBeNull();
        });

        it("should return nothing for a commit no remote has", async () => {
            // arrange - the link would 404, which is worse than saying nothing
            const root = makeRepo({ push: false });

            // act
            const link = await new GitPermalinkSource().forDefinition(definitionIn(root));

            // assert
            expect(link).toBeNull();
        });

        describe.each([
            ["the remote is not github", { remote: "git@gitlab.com:acme/widgets.git" }],
            ["there is no remote at all", { remote: null }]
        ])("when %s", (_label, options) => {
            it("should return nothing rather than a link that goes nowhere", async () => {
                // arrange
                const root = makeRepo(options);

                // act
                const link = await new GitPermalinkSource().forDefinition(definitionIn(root));

                // assert
                expect(link).toBeNull();
            });
        });

        it("should return nothing outside a checkout", async () => {
            // arrange
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "barky-nogit-"));
            temporaryDirs.push(root);
            fs.writeFileSync(path.join(root, "rules.yaml"), "web:\n");

            // act
            const link = await new GitPermalinkSource().forDefinition({
                ...definitionIn(root),
                filePath: path.join(root, "rules.yaml")
            });

            // assert
            expect(link).toBeNull();
        });

        describe.each([
            ["no definition", null],
            ["a definition with no file", { filePath: null }]
        ])("given %s", (_label, overrides) => {
            it("should return nothing rather than throw", async () => {
                const definition = overrides
                    ? { ...definitionIn("/nowhere"), ...overrides } as IDefinition
                    : null;
                expect(await new GitPermalinkSource().forDefinition(definition)).toBeNull();
            });
        });
    });
});
