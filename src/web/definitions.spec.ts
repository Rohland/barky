import { WebDefinitions } from "./definitions.js";
import { ConfigDefinitionSource, IDefinition, IDefinitionSource } from "../chatops/definitions.js";
import { IPermalinkSource } from "../chatops/permalink.js";
import { getConfig } from "../config.js";

describe("web definitions", () => {

    const rulesFile = "./tests/files/definitions.yaml";

    const definition = {
        alertId: "mysql::replication::status",
        key: "replication",
        type: "mysql",
        filePath: "/checks/definitions.yaml",
        displayPath: "tests/files/definitions.yaml",
        yaml: "replication:\n  connection: ca-slave",
        firstLine: 10,
        lastLine: 14,
        variation: "za",
        redacted: 2,
        monitorFor: "replication"
    } as IDefinition;

    function sourceReturning(found: IDefinition): IDefinitionSource {
        return { find: () => found };
    }

    function permalinksReturning(url: string): IPermalinkSource {
        return { forDefinition: async () => url };
    }

    describe("find", () => {
        describe("a check that is in the rules", () => {
            it("should return the block declaring it, with everything needed to describe it", async () => {
                // arrange
                const sut = new WebDefinitions(
                    sourceReturning(definition),
                    permalinksReturning("https://github.com/codeo/checks/blob/abc/definitions.yaml#L10-L14"));

                // act
                const result = await sut.find("mysql::replication::status");

                // assert
                expect(result).toEqual({
                    id: "mysql::replication::status",
                    found: true,
                    key: "replication",
                    type: "mysql",
                    displayPath: "tests/files/definitions.yaml",
                    yaml: "replication:\n  connection: ca-slave",
                    firstLine: 10,
                    lastLine: 14,
                    variation: "za",
                    redacted: 2,
                    monitorFor: "replication",
                    permalink: "https://github.com/codeo/checks/blob/abc/definitions.yaml#L10-L14"
                });
            });
            it("should not carry the file path it was read from", async () => {
                // arrange - the dashboard is served to whoever can reach it, and the layout of the
                // box barky runs on is not part of the answer. displayPath is what it shows
                const sut = new WebDefinitions(sourceReturning(definition), permalinksReturning(null));

                // act
                const result = await sut.find("mysql::replication::status");

                // assert
                expect(result["filePath"]).toBeUndefined();
                expect(JSON.stringify(result)).not.toContain("/checks/definitions.yaml");
            });
            describe("where no link can be built", () => {
                it("should still return the definition", async () => {
                    // arrange - no git, not a checkout, or a commit no remote has yet
                    const sut = new WebDefinitions(sourceReturning(definition), permalinksReturning(null));

                    // act
                    const result = await sut.find("mysql::replication::status");

                    // assert
                    expect(result.found).toEqual(true);
                    expect(result.permalink).toBeNull();
                });
            });
        });

        describe("a check that is not in the rules", () => {
            it("should say so rather than returning nothing", async () => {
                // arrange - renamed or removed since it last fired
                const permalinks = { forDefinition: jest.fn() };
                const sut = new WebDefinitions(sourceReturning(null), permalinks);

                // act
                const result = await sut.find("web::health::gone.com");

                // assert
                expect(result).toEqual({ id: "web::health::gone.com", found: false });
                expect(permalinks.forDefinition).not.toHaveBeenCalled();
            });
        });

        describe("when the rules cannot be read", () => {
            it("should report that, rather than that the check is gone", async () => {
                // arrange - a file edited mid-read reads very differently to a check that was
                // removed, and someone looking for one they just declared needs to know which
                const sut = new WebDefinitions(
                    { find: () => { throw new Error("yaml is broken"); } },
                    permalinksReturning(null));

                // act
                const result = await sut.find("mysql::replication::status");

                // assert
                expect(result).toEqual({
                    id: "mysql::replication::status",
                    found: false,
                    unreadable: true
                });
            });
        });

        describe.each([[null], [undefined], [""]])("given '%s' as the id", (id) => {
            it("should answer without going near the rules", async () => {
                // arrange
                const source = { find: jest.fn() };
                const sut = new WebDefinitions(source, permalinksReturning(null));

                // act
                const result = await sut.find(id);

                // assert
                expect(result).toEqual({ id: null, found: false });
                expect(source.find).not.toHaveBeenCalled();
            });
        });

        describe("over the rules barky actually runs", () => {
            // the same source chat ops answers "define" from, so the dashboard and slack cannot
            // disagree about what barky is configured to check
            function sutOverTheRules(): WebDefinitions {
                // read through getConfig so the imports and the __configPath tagging are the real
                // thing
                return new WebDefinitions(
                    new ConfigDefinitionSource(() => getConfig({ rules: rulesFile }).env),
                    permalinksReturning(null));
            }

            it("should answer for an alert id the dashboard has to hand", async () => {
                // act
                const result = await sutOverTheRules().find("web::health::comms.engine.za");

                // assert
                expect(result.found).toEqual(true);
                expect(result.key).toEqual("comms.engine.$1");
                expect(result.variation).toEqual("za");
                expect(result.displayPath).toEqual("tests/files/definitions.yaml");
                expect(result.yaml).toContain("url: https://ce.example.com/$1/api/status");
            });
            it("should redact a literal secret before it reaches the browser", async () => {
                // arrange - the dashboard is served to whoever can reach it, so a value inline in
                // the block goes the same way it does on its way into slack

                // act
                const result = await sutOverTheRules().find("web::health::whats-app-bot(prod)");

                // assert
                expect(result.found).toEqual(true);
                expect(result.yaml).toContain("Authorization: ***redacted***");
                expect(result.yaml).not.toContain("ak4nqf3HorvnHPxdG9XtXwcQz7nWythRrYADDzN");
                expect(result.redacted).toEqual(1);
            });
        });
    });
});
