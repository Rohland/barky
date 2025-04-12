import { sortBy } from "./sort";

describe("sortBy", () => {
    describe.each([
        [
            "strings",
            [{ field: "b" }, { field: "a" }],
            ["a", "b"]
        ],
        [
            "numbers",
            [{ field: 9 }, { field: 99 }, { field: 10 }, { field: 9.9 }, { field: 0.9 }],
            [0.9, 9, 9.9, 10, 99]
        ],
        [
            "dates",
            [{ field: new Date("2025-01-01 10:00") }, { field: new Date("2024-01-01 10:00") }, { field: new Date("2025-01-01 11:00") }],
            [new Date("2024-01-01 10:00"), new Date("2025-01-01 10:00"), new Date("2025-01-01 11:00")]
        ]
    ])("when sorting by %s", (type, input, expected) => {
        it("should sort", () => {
            // @ts-ignore
            const sorted = sortBy(input, "field");
            expect(sorted.map(x => x.field)).toEqual(expected);
        });
    });
});
