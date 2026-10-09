export class BinaryHeap<T> {
  private readonly values: T[] = [];

  constructor(private readonly comesBefore: (left: T, right: T) => boolean) {}

  get size(): number {
    return this.values.length;
  }

  peek(): T | undefined {
    return this.values[0];
  }

  push(value: T): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.comesBefore(this.values[index]!, this.values[parent]!)) break;
      [this.values[parent], this.values[index]] = [this.values[index]!, this.values[parent]!];
      index = parent;
    }
  }

  pop(): T | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (this.values.length === 0 || last === undefined) return first;
    this.values[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.values.length && this.comesBefore(this.values[left]!, this.values[best]!)) best = left;
      if (right < this.values.length && this.comesBefore(this.values[right]!, this.values[best]!)) best = right;
      if (best === index) break;
      [this.values[index], this.values[best]] = [this.values[best]!, this.values[index]!];
      index = best;
    }
    return first;
  }
}
