#!/bin/bash
# Trusted setup script — run once to compile the circuit and generate keys.
# Do not run this again unless you want to regenerate everything from scratch.
set -e

echo "--- ZK Age Proof: Trusted Setup ---"
echo ""

CIRCUIT_DIR="$(dirname "$0")"
cd "$CIRCUIT_DIR"

echo "[1/7] Installing dependencies..."
npm install snarkjs circomlib
echo "done"
echo ""

echo "[2/7] Compiling age_check.circom..."
# Produces: age_check.r1cs, age_check_js/ (wasm prover), age_check.sym
npx --yes circom2 age_check.circom --r1cs --wasm --sym --output . -l node_modules
echo "done"
echo ""

echo "[3/7] Generating Powers of Tau (phase 1)..."
# pot12 supports up to 2^12 constraints, our circuit needs about 50
npx snarkjs powersoftau new bn128 12 pot12_0000.ptau -v
npx snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau \
    --name="First contribution" -v -e="random entropy for age proof"
npx snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v
echo "done"
echo ""

echo "[4/7] Groth16 circuit-specific setup (phase 2)..."
npx snarkjs groth16 setup age_check.r1cs pot12_final.ptau circuit_0000.zkey
npx snarkjs zkey contribute circuit_0000.zkey circuit_final.zkey \
    --name="Age proof contribution" -v -e="more random entropy"
echo "done"
echo ""

echo "[5/7] Exporting verification key..."
npx snarkjs zkey export verificationkey circuit_final.zkey verification_key.json
echo "done"
echo ""

echo "[6/7] Copying wasm and zkey to frontend/public..."
mkdir -p ../frontend/public
cp age_check_js/age_check.wasm ../frontend/public/age_check.wasm
cp circuit_final.zkey ../frontend/public/circuit_final.zkey
echo "done"
echo ""

echo "[7/7] Copying verification key to backend..."
cp verification_key.json ../backend/verification_key.json
echo "done"
echo ""

echo "--- Setup complete ---"
echo ""
echo "Files created:"
echo "  frontend/public/age_check.wasm"
echo "  frontend/public/circuit_final.zkey"
echo "  backend/verification_key.json"
echo ""
echo "You can now start the backend and frontend."
