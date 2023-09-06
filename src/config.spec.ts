import { getConfig } from "./config";

describe("cli", () => {
    describe("getConfig", () => {
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
                                url: "https://codeo.co.za"
                            },
                            "www.codeo.co.za": {
                                "url": "https://www.codeo.co.za"
                            },
                            "codeo.dev": {
                                url: "https://codeo.dev"
                            }
                        },
                        mysql: {
                            "test": {
                                connection: "test"
                            }
                        }
                    },
                })
            });
        });
    });
});
