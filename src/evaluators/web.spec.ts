import axios, { AxiosResponse } from "axios";
import { execWebRequest, getCustomHeaders, isFailureWebResult, IWebResponse, validateCertificateExpiry } from "./web";
import * as https from "node:https";
import { IApp } from "../models/app";
import { WebResult } from "../models/result";

const second = 1000;
jest.setTimeout(10 * second); // httpbin and badssl aren't the fastest

describe("web evaluator", () => {
    describe("isFailureWebResult", () => {
        describe("when no validator", () => {
            it("should return false", async () => {
                // arrange
                // act
                const result = isFailureWebResult({} as AxiosResponse, null);

                // assert
                expect(result).toEqual(false);
            });
        });
        describe("with validator", () => {
            describe("with json evaluator", () => {
                describe("with no expression", () => {
                    it("should return true", async () => {
                        const web = { data: { number: 123 } } as AxiosResponse;
                        const result = isFailureWebResult(
                            web,
                            {
                                json: undefined
                            });
                        expect(result).toEqual(false);
                    });
                });
                describe("with expression", () => {
                    describe("that passes", () => {
                        it("should return false", async () => {
                            const web = { data: { number: 123 } } as AxiosResponse;
                            const result = isFailureWebResult(
                                web,
                                {
                                    json: "number >= 123"
                                });
                            expect(result).toEqual(false);
                        });
                        it("should support non-js characters is keys", async () => {
                            const web = { data: { "my-number:x": 123 } } as AxiosResponse;
                            const result = isFailureWebResult(
                                web,
                                {
                                    json: "my_number_x >= 123"
                                });
                            expect(result).toEqual(false);
                        });
                    });
                    describe("that fails", () => {
                        it("should return true", async () => {
                            const web = { data: { number: { value: 123 } } } as AxiosResponse;
                            const validator = {
                                json: "number.value < 123",
                                message: "number was {{ number.value }}"
                            };
                            const result = isFailureWebResult(
                                web,
                                validator
                            );
                            expect(result).toEqual(true);
                            expect(validator.message).toEqual("number was 123");
                        });
                    });
                    describe("that is valid but response is not json", () => {
                        it("should return true with message", async () => {
                            const web = { data: "asdf" } as AxiosResponse;
                            const validator = {
                                json: "true",
                                message: undefined
                            };
                            const result = isFailureWebResult(
                                web,
                                validator
                            );
                            expect(result).toEqual(true);
                            expect(validator.message).toMatch(`invalid json expression or unexpected result (\"asdf\")`);
                        });
                    });
                    describe("that is invalid", () => {
                        it("should return true", async () => {
                            const web = { data: { number: 123 } } as AxiosResponse;
                            const validator = {
                                json: "wat?!@",
                                message: undefined
                            };
                            const result = isFailureWebResult(
                                web,
                                validator
                            );
                            expect(result).toEqual(true);
                            expect(validator.message).toMatch(`invalid json expression or unexpected result ({\"number\":123})`);
                        });
                    });
                });
            });
            describe("with match evaluator", () => {
                describe.each([
                    ["test 123", "\\d+", false],
                    ["test 123", "\\d", false],
                    ["abctest 123", "abc.*", false],
                    ["test 123", "321", true],
                    ["", "", false],
                    ["abc", "", false],
                    [null, "", false],
                    [undefined, "", false]
                ])(`when given %s and %s`, (text, validator, expected) => {
                    it(`should return ${ expected }`, async () => {
                        const web = { data: text } as AxiosResponse;
                        const trigger = {
                            match: validator,
                            message: null
                        };
                        const result = isFailureWebResult(
                            web,
                            trigger
                        );
                        expect(result).toEqual(expected);
                        if (validator) {
                            expect(trigger.message).toEqual(`expected response to match regex '${ validator }' but didnt`);
                        }
                    });
                });
                describe("with failure and with custom message", () => {
                    it("should use custom message", async () => {
                        const web = { data: "abc" } as AxiosResponse;
                        const trigger = {
                            match: "cba",
                            message: "bleh"
                        };
                        const result = isFailureWebResult(
                            web,
                            trigger
                        );
                        expect(result).toEqual(true);
                        expect(trigger.message).toEqual("bleh");
                    });
                });
                describe("when data is an object", () => {
                    it("should serialise to json then inspect", async () => {
                        // arrange
                        const web = { data: { test: 123 } } as AxiosResponse;

                        // act
                        const result = isFailureWebResult(
                            web,
                            {
                                match: "123"
                            });

                        // assert
                        expect(result).toEqual(false);
                    });
                    it("fail if no match", async () => {
                        // arrange
                        const web = { data: { test: 321 } } as AxiosResponse;

                        // act
                        const result = isFailureWebResult(
                            web,
                            {
                                match: "123"
                            });

                        // assert
                        expect(result).toEqual(true);
                    });
                });
            });
            describe("with text evaluator", () => {
                describe.each([
                    ["test 123", "TEST", false],
                    ["test 123", "test", false],
                    ["abctest 123", "test", false],
                    ["test 123", "321", true],
                    ["", "", false],
                    ["abc", "", false],
                    [null, "", false],
                    [undefined, "", false]
                ])(`when given %s and %s`, (text, validator, expected) => {
                    it(`should return ${ expected }`, async () => {
                        const web = { data: text } as AxiosResponse;
                        const trigger = {
                            text: validator,
                            message: null
                        };
                        const result = isFailureWebResult(
                            web,
                            trigger
                        );
                        expect(result).toEqual(expected);
                        if (validator) {
                            expect(trigger.message).toEqual(`expected response to contain '${ validator }' but didnt`);
                        }
                    });
                });
                describe("with failure and with custom message", () => {
                    it("should use custom message", async () => {
                        const web = { data: "abc" } as AxiosResponse;
                        const trigger = {
                            text: "cba",
                            message: "bleh"
                        };
                        const result = isFailureWebResult(
                            web,
                            trigger
                        );
                        expect(result).toEqual(true);
                        expect(trigger.message).toEqual("bleh");
                    });
                });
                describe("when data is an object", () => {
                    it("should serialise to json then inspect", async () => {
                        // arrange
                        const web = { data: { test: 123 } } as AxiosResponse;

                        // act
                        const result = isFailureWebResult(
                            web,
                            {
                                text: "123"
                            });

                        // assert
                        expect(result).toEqual(false);
                    });
                });
            });
        });
    });
    describe("getCustomHeaders", () => {
        describe("with none", () => {
            describe.each([
                [null],
                [undefined],
                [{}]
            ])(`when given %s`, (headers) => {
                it("should return empty", async () => {
                    // arrange
                    // act
                    const result = getCustomHeaders(headers);
                    // assert
                    expect(result).toEqual({});
                });
            });
        });
        describe("with env var", () => {
            describe("but is not set", () => {
                it("should return value", async () => {
                    // arrange
                    const headers = {
                        test: "$123"
                    };
                    // act
                    const result = getCustomHeaders(headers);

                    // assert
                    expect(result.test).toEqual("$123");
                });
            });
            describe("and is set", () => {
                it("should return env var", async () => {
                    // arrange
                    const headers = {
                        test: "$my-test-header"
                    };
                    process.env["my-test-header"] = "321";

                    // act
                    const result = getCustomHeaders(headers);

                    // assert
                    expect(result.test).toEqual("321");
                });
                describe("even when its a numeric value", () => {
                    it("should return env var", async () => {
                        // arrange
                        const headers = {
                            test: 1
                        };
                        process.env["my-test-header"] = "321";

                        // act
                        const result = getCustomHeaders(headers);

                        // assert
                        expect(result.test).toEqual(1);
                    });
                });
            });
        });
    });

    describe("executeWebRequest", () => {
        it("should tack on __barky param and set timeout", async () => {
            // arrange
            const app = {
                url: "https://httpbingo.org/get"
            };

            // act
            const response = await execWebRequest(app);

            // assert
            const timestamp = new Date(parseInt(response.data.args.__barky));
            const timeDiff = +new Date() - +timestamp;
            expect(timeDiff).toBeLessThan(10000);
        });
        describe("without http method", () => {
            it("should default to get", async () => {
                // arrange
                const app = {
                    url: "https://httpbingo.org/get"
                };

                // act
                const response = await execWebRequest(app);

                // assert
                expect(response.status).toEqual(200);
            });
        });
        describe("with ssl url", () => {
            describe("and default tls configuration", () => {
                describe("with valid certificate", () => {
                    it("should include cert details in response", async () => {
                        // arrange
                        const app = {
                            url: "https://httpbin.org/get"
                        };

                        // act
                        const response = await execWebRequest(app);

                        // assert
                        expect(response.certInfo).toBeDefined();
                        expect(response.certInfo.validFrom).toBeDefined();
                        expect(response.certInfo.validTo).toBeDefined();
                    });
                });
                describe("with bad certificate", () => {
                    it("should throw", async () => {
                        // arrange
                        const app = {
                            url: "https://wrong.host.badssl.com/"
                        };

                        // act && assert
                        await expect(() => execWebRequest(app)).rejects.toThrow(/does not match certificate's altnames/);
                    });
                });
                describe("with expired certificate", () => {
                    it("should throw", async () => {
                        // arrange
                        const app = {
                            url: "https://expired.badssl.com/"
                        };

                        // act && assert
                        await expect(() => execWebRequest(app)).rejects.toThrow(/certificate has expired/);
                    });
                });
                describe("but with verify set to false", () => {
                    it("should not throw", async () => {
                        // arrange
                        const app = {
                            url: "https://self-signed.badssl.com/",
                            tls: {
                                verify: false
                            }
                        };

                        // act
                        const result = await execWebRequest(app);

                        // assert
                        expect(result.status).toEqual(200);
                    });
                });
            });
        });
    });

    describe("validateCertificateExpiry", () => {
        describe("with no certInfo", () => {
            it("should not add a result", async () => {
                // arrange
                const results = [];

                // act
                validateCertificateExpiry(
                    {} as IApp,
                    new Date(),
                    {} as IWebResponse,
                    results);

                // assert
                expect(results).toEqual([]);
            });
        });
        describe.each([
            [null],
            [undefined]
        ])(`with null/undefined`, (webResult) => {
            it("should not add a result", async () => {
                // arrange
                const results = [];

                // act
                validateCertificateExpiry(
                    {} as IApp,
                    new Date(),
                    webResult,
                    results);

                // assert
                expect(results).toEqual([]);
            });
        });
        describe("with certInfo", () => {
            describe("but verify false", () => {
                it("should not add a failure result", async () => {
                    // arrange
                    const results = [];
                    const app = {
                        tls: {
                            verify: false
                        }
                    } as IApp;
                    const webResult = {
                        certInfo: {
                            validTo: new Date("1900-01-01")
                        }
                    } as IWebResponse;

                    // act
                    validateCertificateExpiry(
                        app,
                        new Date(),
                        webResult,
                        results);

                    // assert
                    expect(results).toEqual([]);
                });
            });
            describe("with verify true, but not expired", () => {
                it("should not add result", async () => {
                    // arrange
                    const results = [];
                    const app = {
                        tls: {
                            verify: true
                        }
                    } as IApp;
                    const webResult = {
                        certInfo: {
                            validTo: new Date("2100-01-01")
                        }
                    } as IWebResponse;

                    // act
                    validateCertificateExpiry(
                        app,
                        new Date(),
                        webResult,
                        results);

                    // assert
                    expect(results).toEqual([]);
                });
            });
            describe("with verify true and expiring", () => {
                describe("with default configuration", () => {
                    describe("but not expiring soon", () => {
                        it("should not add result", async () => {
                            // arrange
                            const results = [] as WebResult[];
                            const app = {
                                name: "codeo.co.za",
                                tls: {
                                    verify: true,
                                }
                            } as IApp;
                            const now = new Date();
                            const expiry = new Date(now.setDate(now.getDate() + 8));
                            const webResult = {
                                certInfo: {
                                    validTo: expiry
                                }
                            } as IWebResponse;

                            // act
                            validateCertificateExpiry(
                                app,
                                new Date(),
                                webResult,
                                results);

                            // assert
                            expect(results).toEqual([]);
                        });
                        describe("even with custom config", () => {
                            it("should not return failure result", async () => {
                                // arrange
                                const results = [] as WebResult[];
                                const app = {
                                    name: "codeo.co.za",
                                    tls: {
                                        verify: true,
                                        expiry: "1d"
                                    }
                                } as IApp;
                                const now = new Date();
                                const expiry = new Date(now.setDate(now.getDate() + 2));
                                const webResult = {
                                    certInfo: {
                                        validTo: expiry
                                    }
                                } as IWebResponse;

                                // act
                                validateCertificateExpiry(
                                    app,
                                    new Date(),
                                    webResult,
                                    results);

                                // assert
                                expect(results).toEqual([]);
                            });
                        });
                    });
                    it("should add failure result", async () => {
                        // arrange
                        const results = [] as WebResult[];
                        const app = {
                            name: "codeo.co.za",
                            tls: {
                                verify: true,
                            }
                        } as IApp;
                        const now = new Date();
                        const expiry = new Date(now.setDate(now.getDate() + 4));
                        const webResult = {
                            certInfo: {
                                validTo: expiry
                            }
                        } as IWebResponse;

                        // act
                        validateCertificateExpiry(
                            app,
                            new Date(),
                            webResult,
                            results);

                        // assert
                        expect(results.length).toEqual(1);
                        const result = results[0];
                        expect(result.success).toEqual(false);
                        expect(result.label).toEqual("cert-expiring");
                        expect(result.identifier).toEqual("codeo.co.za");
                        expect(result.result).toEqual("96.00");
                        expect(result.resultMsg).toMatch(/expiring in \d+\.\d+ days/);
                    });
                    describe("and within 24 hours", () => {
                        it("should emit time in hours", async () => {
                            // arrange
                            const results = [] as WebResult[];
                            const app = {
                                name: "codeo.co.za",
                                tls: {
                                    verify: true,
                                }
                            } as IApp;
                            const now = new Date();
                            const expiry = new Date(now.setHours(now.getHours() + 12));
                            const webResult = {
                                certInfo: {
                                    validTo: expiry
                                }
                            } as IWebResponse;

                            // act
                            validateCertificateExpiry(
                                app,
                                new Date(),
                                webResult,
                                results);

                            // assert
                            const result = results[0];
                            expect(result.result).toEqual("12.00");
                            expect(result.resultMsg).toMatch(/expiring in \d+\.\d+ hours/);
                        });
                    });
                });
                describe("with custom configuration", () => {
                    it("should add failure result", async () => {
                        // arrange
                        const results = [] as WebResult[];
                        const app = {
                            name: "codeo.co.za",
                            tls: {
                                verify: true,
                                expiry: "3d"
                            }
                        } as IApp;
                        const now = new Date();
                        const expiry = new Date(now.setDate(now.getDate() + 2));
                        const webResult = {
                            certInfo: {
                                validTo: expiry
                            }
                        } as IWebResponse;

                        // act
                        validateCertificateExpiry(
                            app,
                            new Date(),
                            webResult,
                            results);

                        // assert
                        expect(results.length).toEqual(1);
                        const result = results[0];
                        expect(result.success).toEqual(false);
                        expect(result.label).toEqual("cert-expiring");
                        expect(result.identifier).toEqual("codeo.co.za");
                        expect(result.result).toEqual("48.00");
                        expect(result.resultMsg).toMatch(/expiring in \d+\.\d+ days/);
                    });
                });

            });
        });
    });

    describe("exploratory", () => {
        describe("when monitoring a domain with TLS", () => {
            xit("can inspect the certificate info", async () => {
                // arrange
                // act
                let tlsCert;
                await axios({
                    url: "https://www.codeo.co.za",
                    method: "GET",
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false
                    })
                        .on('keylog', (_, tlsSocket) => {
                            const certInfo = tlsSocket.getPeerCertificate(false);
                            if (certInfo.valid_from) {
                                tlsCert = certInfo;
                            }
                        })
                });
                // assert
                console.log(tlsCert);
                const validFrom = new Date(tlsCert.valid_from);
                const validTo = new Date(tlsCert.valid_to);
                console.log(validFrom);
                console.log(validTo);
            });
        });
    })
});
