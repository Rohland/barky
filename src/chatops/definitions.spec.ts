import fs from "fs";
import { ConfigDefinitionSource } from "./definitions.js";
import { getConfig } from "../config.js";

describe("chatops definitions", () => {

    const rulesFile = "./tests/files/definitions.yaml";
    const importedFile = "tests/files/definitions-import.yaml";
    const importedShellFile = "tests/files/definitions-import-shell.yml";

    function getSut(): ConfigDefinitionSource {
        // read through getConfig so the imports and the __configPath tagging are the real thing
        return new ConfigDefinitionSource(() => getConfig({ rules: rulesFile }).env);
    }

    describe("find", () => {
        describe("a check that puts its name in the label", () => {
            it("should return the block declaring it", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("mysql::replication::status");

                // assert
                expect(definition.key).toEqual("replication");
                expect(definition.type).toEqual("mysql");
                expect(definition.displayPath).toEqual("tests/files/definitions.yaml");
                expect(definition.yaml).toContain("replication:");
                expect(definition.yaml).toContain("show slave status");
                expect(definition.variation).toBeNull();
            });
            it("should read as a standalone block rather than something lifted out of a map", async () => {
                // arrange - the key sits two spaces in under "mysql:", and every line with it
                const sut = getSut();

                // act
                const definition = sut.find("mysql::replication::status");

                // assert
                const lines = definition.yaml.split("\n");
                expect(lines[0]).toEqual("replication:");
                expect(lines[1]).toEqual("  connection: ca-slave");
            });
            it("should stop at the end of its own block", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("mysql::replication::status");

                // assert - "alert:" is the last key in the block, and what follows it belongs to it
                expect(definition.yaml).toContain("count: 3");
                expect(definition.yaml).not.toContain("web:");
                expect(definition.yaml).not.toContain("sumo:");
            });
        });

        describe("a web check, which puts its name in the identifier", () => {
            it("should return the block declaring it", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("web::health::comms.engine.za");

                // assert
                expect(definition.key).toEqual("comms.engine.$1");
                expect(definition.yaml).toContain("url: https://ce.example.com/$1/api/status");
            });
            it("should name the vary-by instance the alert is", async () => {
                // arrange
                const sut = getSut();

                // act
                const za = sut.find("web::health::comms.engine.za");
                const bw = sut.find("web::health::comms.engine.bw");

                // assert
                expect(za.variation).toEqual("za");
                expect(bw.variation).toEqual("bw");
                expect(bw.key).toEqual("comms.engine.$1");
            });
            it("should find a check reported under a name it overrides", async () => {
                // arrange - the alert is reported as whats-app-bot(prod), not as the config key
                const sut = getSut();

                // act
                const definition = sut.find("web::health::whats-app-bot(prod)");

                // assert
                expect(definition.key).toEqual("whatsapp-bot-za-prod");
            });
        });

        describe("a check declared in an imported file", () => {
            it("should read the file that actually declares it", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("sumo::aws-root-login-monitor::Yumbi");

                // assert
                expect(definition.displayPath).toEqual(importedFile);
                expect(definition.yaml).toContain("aws-root-login-monitor:");
                expect(definition.yaml).toContain("count by accountId");
            });
            it("should read it where the import named the file without its extension", async () => {
                // arrange - the path tagged on the check is the file it was read out of, which is
                // not the path the import asked for and does not exist on disk
                const sut = getSut();

                // act
                const definition = sut.find("shell::disk-space::/dev/disk1s1");

                // assert
                expect(definition.displayPath).toEqual(importedShellFile);
                expect(definition.yaml).toContain("disk-space:");
            });
        });

        describe("comments", () => {
            it("should keep the ones inside the block", async () => {
                // arrange - re-serialising the loaded config would have lost this
                const sut = getSut();

                // act
                const definition = sut.find("web::health::comms.engine.za");

                // assert
                expect(definition.yaml).toContain("# the service answers 404 when it is healthy");
            });
            it("should leave out the ones above it", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("web::health::comms.engine.za");

                // assert
                expect(definition.yaml).not.toContain("this comment sits above the block");
            });
        });

        describe("keys the loaded config carries but the file does not", () => {
            it("should not appear in the block", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("mysql::replication::status");

                // assert
                expect(definition.yaml).not.toContain("__configPath");
                expect(definition.yaml).not.toContain("type: mysql");
            });
        });

        describe("line numbers", () => {
            it("should point at the block in its file", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("mysql::replication::status");

                // assert - sliced back out of the file, the lines named are the block
                const lines = fs.readFileSync(definition.filePath, "utf8").split("\n");
                const named = lines.slice(definition.firstLine - 1, definition.lastLine);
                expect(named[0].trim()).toEqual("replication:");
                expect(named.length).toEqual(definition.yaml.split("\n").length);
            });
        });

        describe("a monitor row", () => {
            it("should answer with the check it is the monitor for", async () => {
                // arrange - type::monitor::name is emitted when the check could not run at all
                const sut = getSut();

                // act
                const definition = sut.find("mysql::monitor::replication");

                // assert
                expect(definition.key).toEqual("replication");
                expect(definition.monitorFor).toEqual("replication");
            });
            it("should not be claimed by a check whose own label is monitor", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("mysql::replication::status");

                // assert
                expect(definition.monitorFor).toBeNull();
            });
        });

        describe("secrets", () => {
            it("should hide a literal value under a sensitive key", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("web::health::whats-app-bot(prod)");

                // assert
                expect(definition.yaml).not.toContain("ak4nqf3HorvnHPxdG9XtXwcQz7nWythRrYADDzN");
                expect(definition.yaml).toContain("Authorization: ***redacted***");
                expect(definition.redacted).toEqual(1);
            });
            it("should show a value that names an environment variable", async () => {
                // arrange - barky's configuration names variables rather than holding secrets, and
                // hiding those would make the answer useless
                const sut = getSut();

                // act
                const definition = sut.find("web::health::whats-app-bot(prod)");

                // assert
                expect(definition.yaml).toContain("Token: sumo-token");
            });
            it("should show a variable named with the $ form", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("web::health::comms.engine.za");

                // assert
                expect(definition.yaml).toContain("Authorization: $whatsapp-bot-token-za");
                expect(definition.redacted).toEqual(0);
            });
            it("should hide one inside an inline map", async () => {
                // arrange - the value carries a comma of its own, which is not a pair separator
                const sut = getSut();

                // act
                const definition = sut.find("web::health::inline.example.com");

                // assert
                expect(definition.yaml).not.toContain("8f14e45fceea167a5a36dedd4bea2543");
                expect(definition.yaml).not.toContain("and more");
                expect(definition.yaml).toContain("Accept: application/json");
                expect(definition.redacted).toEqual(1);
            });
            it("should hide one inside an inline map when the key is quoted", async () => {
                // arrange
                const sut = getSut();

                // act
                const definition = sut.find("web::health::quoted.example.com");

                // assert
                expect(definition.yaml).not.toContain("1f0e3dad99908345f7439f8ffabdffc4");
                expect(definition.yaml).toContain("Accept: application/json");
                expect(definition.redacted).toEqual(1);
            });
            it("should hide a value that does not read as a variable name", async () => {
                // arrange - a variable is named in one case and in separated words, so a single
                // run of characters is a passphrase however short it is, and so is a separated
                // one too long for anyone to have typed as a name
                const sut = getSut();

                // act
                const definition = sut.find("web::health::bare.example.com");

                // assert
                expect(definition.yaml).not.toContain("letmein123");
                expect(definition.yaml).not.toContain("prod-db-password-2024");
                expect(definition.yaml).toContain("Token: sumo-token");
                expect(definition.redacted).toEqual(2);
            });
        });

        describe("an alert nothing declares", () => {
            describe.each([
                ["a check that has been renamed or removed", "web::health::gone.example.com"],
                ["an evaluator with nothing configured", "shell::backups::nightly"],
                ["the watchdog's own configuration failure", "watchdog::configuration::watchdog"],
                ["an id that is not an id at all", "nonsense"],
                ["nothing at all", ""]
            ])("given %s", (_label, alertId) => {
                it("should return null rather than guess", async () => {
                    expect(getSut().find(alertId)).toBeNull();
                });
            });
        });

        describe("when the rules cannot be read", () => {
            it("should return null rather than throw", async () => {
                // arrange
                const sut = new ConfigDefinitionSource(() => null);

                // act
                const definition = sut.find("mysql::replication::status");

                // assert
                expect(definition).toBeNull();
            });
        });

        describe("when the configuration is edited while barky runs", () => {
            it("should answer out of the file as it is now", async () => {
                // arrange - the provider is read on every call for exactly this reason
                let rules: any = getConfig({ rules: rulesFile }).env;
                const sut = new ConfigDefinitionSource(() => rules);
                expect(sut.find("mysql::replication::status")).not.toBeNull();

                // act
                rules = { mysql: {} };

                // assert
                expect(sut.find("mysql::replication::status")).toBeNull();
            });
        });
    });
});
