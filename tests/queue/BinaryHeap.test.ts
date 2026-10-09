import { BinaryHeap } from "../../src/queue/BinaryHeap.js";

describe("BinaryHeap", () => {
  test("removes values in comparator order while preserving duplicates", () => {
    const heap = new BinaryHeap<number>((left, right) => left > right);
    for (const value of [4, 1, 9, 2, 9]) heap.push(value);

    expect([heap.pop(), heap.pop(), heap.pop(), heap.pop(), heap.pop()])
      .toEqual([9, 9, 4, 2, 1]);
    expect(heap.pop()).toBeUndefined();
  });
});
