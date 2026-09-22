// circomlibjs ships no types; the deploy scripts only use poseidonContract.
declare module 'circomlibjs' {
  export const poseidonContract: {
    generateABI(nInputs: number): import('ethers').JsonFragment[];
    createCode(nInputs: number): string;
  };
}

// snarkjs ships no types either; the tests only call groth16.fullProve.
declare module 'snarkjs';
