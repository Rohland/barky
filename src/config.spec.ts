import { getConfig } from "./config";

describe("cli", () => {
    describe("getConfig", () =>{
        describe.each([
            ["importer", "yaml"],
            ["importer_yml", "yml"]
        ])(`with file %s and extension %s`, (file) => {
            it("should be able to parse and validate config", async () => {
                // arrange
                const rel = `./tests/files/${file}`;
                const args = {
                    rules: rel
                };
                console.log(__dirname);

                // act
                const config = getConfig(args);

                // assert
                expect(config).toMatchObject(args);
            });
        });
        describe("when includes import tag", () => {
            it("should iterate and include rules from other files", async () => {
                // arrange
                const rel = "./tests/files/importer.yaml";
                const args = {
                    rules: rel
                };
                console.log(__dirname);

                // act
                const config = getConfig(args);

                // assert
                expect(config).toMatchObject(args);
                expect(config.fileName).toEqual("importer");
                expect(config.digest).toEqual(null);
                expect(config.env.import.length).toEqual(2);
                expect(config).toMatchObject({
                    env: {
                        config: {
                            locale: "en-ZA",
                            timezone: "Africa/Johannesburg"
                        },
                        web: {
                            "codeo.co.za": {
                                url: "https://codeo.co.za",
                                __configPath: expect.stringContaining("tests/files/importer.yaml")
                            },
                            "www.codeo.co.za": {
                                "url": "https://www.codeo.co.za",
                                __configPath: expect.stringContaining("tests/files/import-1.yaml")
                            },
                            "codeo.dev": {
                                url: "https://codeo.dev",
                                __configPath:  expect.stringContaining("tests/files/import-2.yaml")
                            }
                        },
                        mysql: {
                            "test": {
                                connection: "test",
                                __configPath: expect.stringContaining("tests/files/import-1.yaml")
                            }
                        }
                    },
                })
            });
        });
    });
});
