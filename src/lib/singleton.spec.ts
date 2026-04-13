import { asyncSingleton, deregisterSingleton, singleton } from "./singleton.js";
import { uuid } from "./uuid.js";

describe("singleton", () => {
    describe("when not registered", () => {
        it("should create a new instance", () => {
            // arrange
            const key = uuid();
            const value = uuid();
            const generator = jest.fn().mockReturnValue(value);

            // act
            const instance = singleton(key, () => generator());

            // assert
            expect(generator).toHaveBeenCalledTimes(1);
            expect(instance).toEqual(value);
        });
    });
    describe("when registered and another instance requested", () => {
        it("should return original instance", () => {
            const key = uuid();
            const generator = jest.fn().mockImplementation(() =>uuid());

            // act
            const instance1 = singleton(key, () => generator());
            const instance2 = singleton(key, () => generator());

            // assert
            expect(generator).toHaveBeenCalledTimes(1);
            expect(instance1).toEqual(instance2);
            expect(instance2).toEqual(instance1);

            deregisterSingleton(key);
            const instance3 = singleton(key, () => generator());
            expect(instance3).not.toEqual(instance1);
        });
        describe("but using a different key", () => {
            it("should generate a new instance", () => {
                const key = uuid();
                const generator = jest.fn().mockReturnValue(uuid());
                const generator2 = jest.fn().mockReturnValue(uuid());

                // act
                const instance1 = singleton(key, () => generator());
                const instance2 = singleton(key + "2", () => generator2());

                // assert
                expect(generator).toHaveBeenCalledTimes(1);
                expect(generator2).toHaveBeenCalledTimes(1);
                expect(instance2).not.toEqual(instance1);
            });
        });
    });
    describe.each([
        null,
        undefined,
        "",
        " "
    ])("if key is %s", (key) => {
        it("should throw", () => {
            // arrange
            // act
            expect(() => singleton(key, () => uuid())).toThrow();
        });
    });
});

describe("asyncSingleton", () => {
    describe("when not registered", () => {
        it("should create a new instance", async () => {
            // arrange
            const key = uuid();
            const value = uuid();
            const generator = jest.fn().mockReturnValue(value);

            // act
            const instance = await asyncSingleton(key, () => generator());

            // assert
            expect(generator).toHaveBeenCalledTimes(1);
            expect(instance).toEqual(value);
        });
    });
    describe("when registered and another instance requested", () => {
        it("should return original instance", async () => {
            const key = uuid();
            const value = uuid();
            const generator = jest.fn().mockResolvedValue(value);

            // act
            const instance1 = await asyncSingleton(key, () => generator());
            const instance2 = await asyncSingleton(key, () => generator());

            // assert
            expect(generator).toHaveBeenCalledTimes(1);
            expect(instance1).toEqual(instance2);
            expect(instance2).toEqual(value);
        });
        describe("but using a different key", () => {
            it("should generate a new instance", async () => {
                const key = uuid();
                const generator = jest.fn().mockResolvedValue(uuid());
                const generator2 = jest.fn().mockResolvedValue(uuid());

                // act
                const instance1 = await asyncSingleton(key, () => generator());
                const instance2 = await asyncSingleton(key + "2", () => generator2());

                // assert
                expect(generator).toHaveBeenCalledTimes(1);
                expect(generator2).toHaveBeenCalledTimes(1);
                expect(instance2).not.toEqual(instance1);
            });
        });
    });
    describe.each([
        null,
        undefined,
        "",
        " "
    ])("if key is %s", (key) => {
        it("should throw", async () => {
            // arrange
            // act
            await expect(() => asyncSingleton(key, () => Promise.resolve(uuid()))).rejects.toThrow();
        });
    });
});
