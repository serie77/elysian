/**
 * Append-only Poseidon Merkle tree mirroring MerkleTreeWithHistory.sol.
 * Leaves are inserted left to right; empty slots hold ZERO_LEAF hashed up the levels.
 */
import { TREE_LEVELS } from './constants.js';
import { ZERO_LEAF, poseidon2 } from './hash.js';

export interface MerklePath {
  pathElements: bigint[];
  pathIndices: number; // leaf index; the circuit decomposes it into bits
  root: bigint;
}

export class MerkleTree {
  readonly levels: number;
  readonly zeros: bigint[];
  private layers: bigint[][];

  constructor(levels: number = TREE_LEVELS, leaves: bigint[] = []) {
    this.levels = levels;
    this.zeros = [ZERO_LEAF];
    for (let i = 1; i <= levels; i++) this.zeros.push(poseidon2([this.zeros[i - 1], this.zeros[i - 1]]));
    this.layers = Array.from({ length: levels + 1 }, () => []);
    this.layers[0] = [...leaves];
    this.rebuild();
  }

  get size(): number {
    return this.layers[0].length;
  }

  get capacity(): number {
    return 2 ** this.levels;
  }

  get root(): bigint {
    return this.layers[this.levels][0] ?? this.zeros[this.levels];
  }

  leaf(index: number): bigint {
    return this.layers[0][index];
  }

  leaves(): bigint[] {
    return [...this.layers[0]];
  }

  insert(leaf: bigint): number {
    if (this.size >= this.capacity) throw new Error('tree is full');
    const index = this.size;
    this.layers[0].push(leaf);
    this.update(index);
    return index;
  }

  bulkInsert(leaves: bigint[]): void {
    for (const l of leaves) this.insert(l);
  }

  path(index: number): MerklePath {
    if (index < 0 || index >= this.size) throw new Error('leaf index out of range');
    const pathElements: bigint[] = [];
    let idx = index;
    for (let level = 0; level < this.levels; level++) {
      const sibling = idx ^ 1;
      pathElements.push(this.layers[level][sibling] ?? this.zeros[level]);
      idx >>= 1;
    }
    return { pathElements, pathIndices: index, root: this.root };
  }

  private update(index: number): void {
    let idx = index;
    for (let level = 0; level < this.levels; level++) {
      const parent = idx >> 1;
      const left = this.layers[level][parent * 2] ?? this.zeros[level];
      const right = this.layers[level][parent * 2 + 1] ?? this.zeros[level];
      this.layers[level + 1][parent] = poseidon2([left, right]);
      idx = parent;
    }
  }

  private rebuild(): void {
    for (let level = 0; level < this.levels; level++) {
      const src = this.layers[level];
      const dst: bigint[] = [];
      for (let i = 0; i < src.length; i += 2) {
        dst.push(poseidon2([src[i], src[i + 1] ?? this.zeros[level]]));
      }
      this.layers[level + 1] = dst;
    }
  }
}
