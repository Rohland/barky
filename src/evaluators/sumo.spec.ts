import { executeSumoRequest } from "./sumo";

describe('sumo ', () => {
    describe('executeSumoRequest', () => {
        describe("when executed with success", () => {
            it("should return result", async () => {
                // arrange
                const request = jest.fn().mockResolvedValue("result");

                // act
                const result = await executeSumoRequest(request);

                // assert
                expect(result).toEqual("result");
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when failure", () => {
            it("should throw error", async () => {
                // arrange
                const request = jest.fn().mockRejectedValue(new Error("error"));

                // act
                let error;
                try {
                    await executeSumoRequest(request);
                } catch (err) {
                    error = err;
                }

                // assert
                expect(error).toEqual(new Error("error"));
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when request takes some time", () => {
            it("should wait", async () => {
                // arrange
                const request = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("result"), 100)));

                // act
                const start = performance.now();
                const result = await executeSumoRequest(request);
                const end = performance.now();

                // assert
                expect(result).toEqual("result");
                expect(end - start).toBeGreaterThanOrEqual(95);
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when multiple requests sent", () => {
            it("should queue them and only execute 5 at a time", async () => {
                // arrange
                const count = 9;
                const requests = [];
                for (let i = 0; i < count; i++) {
                    const req = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(`result${ i }`), 100)));
                    requests.push(req);
                }

                // act
                const start = performance.now();
                const result = await Promise.all(requests.map(x => executeSumoRequest(x)));
                const end = performance.now();

                // assert
                expect(result).toEqual(requests.map((_x,i) => `result${ i }`));
                expect(end - start).toBeGreaterThanOrEqual(295);
                expect(end - start).toBeLessThanOrEqual(350);
                requests.forEach(x => expect(x).toHaveBeenCalledTimes(1));
            });
        });
    });
});
