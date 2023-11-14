import { ShellEvaluator } from "./shell";
import { execShellScript } from "../lib/shell-runner";
import { MonitorFailureResult, ShellResult } from "../models/result";

jest.mock("../lib/shell-runner");

describe("shell evaluator", () => {
    describe("generateSkippedAppUniqueKey", () => {
        it("should return wildcard for identifier", async () => {
            // arrange
            const sut = new ShellEvaluator({});

            // act
            const output = sut.generateSkippedAppUniqueKey("test");

            // assert
            expect(output.type).toEqual("shell");
            expect(output.label).toEqual("test");
            expect(output.identifier).toEqual("*");
        });
    });
    describe("isResultForApp", () => {
        describe("when name matches label", () => {
            it("should return true", async () => {
                // arrange
                const sut = new ShellEvaluator({});

                // act
                const output = sut.isResultForApp({ name: "test" }, { label: "test" } as any);

                // assert
                expect(output).toEqual(true);
            });
        });
        describe("when name does not match label", () => {
            it("should return false", async () => {
                // arrange
                const sut = new ShellEvaluator({});

                // act
                const output = sut.isResultForApp({ name: "abc" }, { label: "test" } as any);

                // assert
                expect(output).toEqual(false);
            });
        });
    });
    describe("tryEvaluate", () => {
        it("should run shell evaluator", async () => {
            // arrange
            const res = {
                exitCode: 0,
                stdout: "hello world"
            };
            const app = {
                name: "test",
                path: "test.sh",
                timeout: 1000,
                __configPath: "/Users/Test/SomeDir/Hello.yaml"
            };
            (execShellScript as jest.Mock).mockResolvedValue(res);
            const sut = new ShellEvaluator({});

            // act
            const results = await sut.tryEvaluate(app);
            const result = [results].flat()[0];

            // assert
            expect(execShellScript).toHaveBeenCalledWith("/Users/Test/SomeDir/test.sh", 1000, undefined);
            expect(result).toBeInstanceOf(ShellResult);
            expect(result.label).toEqual("test");
            expect(result.identifier).toEqual("test");
            expect(result.result).toEqual(JSON.stringify(res));
            expect(result.success).toEqual(true);
        });
        describe("with json response type", () => {
            it("should respond with json data", async () => {
                // arrange
                const shellResponseObj = { hello: "world" };
                const res = {
                    exitCode: 0,
                    stdout: JSON.stringify(shellResponseObj)
                };
                const app = {
                    name: "test",
                    path: "test.sh",
                    timeout: 1000,
                    responseType: "json",
                    __configPath: "/Users/Test/SomeDir/Hello.yaml"
                };
                (execShellScript as jest.Mock).mockResolvedValue(res);
                const sut = new ShellEvaluator({});

                // act
                const results = await sut.tryEvaluate(app);
                const result = [results].flat()[0];

                // assert
                expect(result).toBeInstanceOf(ShellResult);
                expect(result.label).toEqual("test");
                expect(result.identifier).toEqual("test");
                expect(result.result).toEqual(JSON.stringify({ ...shellResponseObj, exitCode: 0}));
                expect(result.success).toEqual(true);
            });
        });
        describe("with vary-by", () => {
            it("should pass as args", async () => {
                // arrange
                const res = {
                    exitCode: 0,
                    stdout: "hello world"
                };
                const app = {

                    name: "test",
                    path: "test.sh",
                    timeout: 1000,
                    "vary-by": ["a", "b"],
                    __configPath: "/Users/Test/SomeDir/Hello.yaml"
                };
                (execShellScript as jest.Mock).mockResolvedValue(res);
                const sut = new ShellEvaluator({});

                // act
                await sut.tryEvaluate(app);

                // assert
                expect(execShellScript).toHaveBeenCalledWith("/Users/Test/SomeDir/test.sh", 1000, ["a", "b"]);
            });
        });
        describe("with rules", () => {
            describe("when rules match", () => {
                it("should return success", async () => {
                    // arrange
                    const shellResponseObj = { count: 1 };
                    const res = {
                        exitCode: 0,
                        stdout: JSON.stringify(shellResponseObj)
                    };
                    const app = {
                        name: "test",
                        path: "test.sh",
                        timeout: 1000,
                        responseType: "json",
                        __configPath: "/Users/Test/SomeDir/Hello.yaml",
                        triggers: [
                            {
                                rules: [
                                    {
                                        expression: "count > 1",
                                        message: "all good!"
                                    }
                                ]
                            }
                        ]
                    };
                    (execShellScript as jest.Mock).mockResolvedValue(res);
                    const sut = new ShellEvaluator({});

                    // act
                    // @ts-ignore
                    const results = await sut.tryEvaluate(app);
                    const result = [results].flat()[0];

                    // assert
                    expect(result).toBeInstanceOf(ShellResult);
                    expect(result.label).toEqual("test");
                    expect(result.identifier).toEqual("test");
                    expect(result.result).toEqual(JSON.stringify({ ...shellResponseObj, exitCode: 0}));
                    expect(result.success).toEqual(true);
                });
                describe("but expression generates failure", () => {
                    it("should return failure result", async () => {
                        // arrange
                        const shellResponseObj = { count: 1 };
                        const res = {
                            exitCode: 0,
                            stdout: JSON.stringify(shellResponseObj)
                        };
                        const app = {
                            name: "test",
                            path: "test.sh",
                            timeout: 1000,
                            responseType: "json",
                            triggers: [
                                {
                                    rules: [
                                        {
                                            expression: "count <= 1",
                                            message: "{{ count }} was not greater than 1"
                                        }
                                    ]
                                }
                            ],
                            __configPath: "/Users/Test/SomeDir/Hello.yaml"
                        };
                        (execShellScript as jest.Mock).mockResolvedValue(res);
                        const sut = new ShellEvaluator({});

                        // act
                        // @ts-ignore
                        const results = await sut.tryEvaluate(app);
                        const result = [results].flat()[0];

                        // assert
                        expect(result).toBeInstanceOf(ShellResult);
                        expect(result.label).toEqual("test");
                        expect(result.identifier).toEqual("test");
                        expect(result.result).toEqual('{\"count\":1,\"exitCode\":0}');
                        expect(result.resultMsg).toEqual("1 was not greater than 1");
                        expect(result.success).toEqual(false);
                    });
                    describe("and using vary-by", () => {
                        it("should evaluate rule matched by variation", async () => {
                            // arrange
                            const shellResponseObj = { count: 1 };
                            const res = {
                                exitCode: 0,
                                stdout: JSON.stringify(shellResponseObj)
                            };
                            const app = {
                                name: "test",
                                path: "test.sh",
                                timeout: 1000,
                                responseType: "json",
                                "vary-by": ["abc"],
                                triggers: [
                                    {
                                        match: "abc",
                                        rules: [
                                            {
                                                expression: "count <= 1",
                                                message: "{{ count }} was not greater than 1 for {{ identifier }}"
                                            }
                                        ]
                                    }
                                ],
                                __configPath: "/Users/Test/SomeDir/Hello.yaml"
                            };
                            (execShellScript as jest.Mock).mockResolvedValue(res);
                            const sut = new ShellEvaluator({});

                            // act
                            // @ts-ignore
                            const results = await sut.tryEvaluate(app);
                            const result = [results].flat()[0];

                            // assert
                            expect(result).toBeInstanceOf(ShellResult);
                            expect(result.label).toEqual("test");
                            expect(result.identifier).toEqual("abc");
                            expect(result.result).toEqual('{\"count\":1,\"exitCode\":0}');
                            expect(result.resultMsg).toEqual("1 was not greater than 1 for abc");
                            expect(result.success).toEqual(false);
                        });
                        describe("but doesn't match rule", () => {
                            it("should evaluate as success", async () => {
                                // arrange
                                const shellResponseObj = { count: 1 };
                                const res = {
                                    exitCode: 0,
                                    stdout: JSON.stringify(shellResponseObj)
                                };
                                const app = {
                                    name: "test",
                                    path: "test.sh",
                                    timeout: 1000,
                                    responseType: "json",
                                    "vary-by": ["abc"],
                                    triggers: [
                                        {
                                            match: "none",
                                            rules: [
                                                {
                                                    expression: "count <= 1",
                                                    message: "{{ count }} was not greater than 1"
                                                }
                                            ]
                                        }
                                    ],
                                    __configPath: "/Users/Test/SomeDir/Hello.yaml"
                                };
                                (execShellScript as jest.Mock).mockResolvedValue(res);
                                const sut = new ShellEvaluator({});

                                // act
                                // @ts-ignore
                                const results = await sut.tryEvaluate(app);
                                const result = [results].flat()[0];

                                // assert
                                expect(result).toBeInstanceOf(ShellResult);
                                expect(result.label).toEqual("test");
                                expect(result.identifier).toEqual("abc");
                                expect(result.result).toEqual('{\"count\":1,\"exitCode\":0}');
                                expect(result.resultMsg).toEqual("OK");
                                expect(result.success).toEqual(true);
                            });
                        });
                    });
                });
            });
        });
        describe("when error", () => {
            it("should return monitor result", async () => {
                // arrange

                const app = {
                    name: "test",
                    path: "test.sh",
                    timeout: 1000,
                    __configPath: "/Users/Test/SomeDir/test.sh"
                };
                const err = new Error("test error");
                (execShellScript as jest.Mock).mockRejectedValue(err);
                const sut = new ShellEvaluator({});

                // act
                const results = await sut.tryEvaluate(app);
                const result = [results].flat()[0];

                // assert
                expect(result).toBeInstanceOf(MonitorFailureResult);
                expect(result.label).toEqual("monitor");
                expect(result.identifier).toEqual("test");
                expect(result.result).toEqual("FAIL");
                expect(result.resultMsg).toEqual("test error");
                expect(result.success).toEqual(false);
            });
        });
    });
});
