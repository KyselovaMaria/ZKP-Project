"""
ZK Age Proof — Backend Verifier
================================
The server ONLY verifies a Groth16 proof.
It never sees the user's age or birthdate.
"""

import json
import subprocess
import os
import tempfile
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="ZK Age Proof Verifier", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent
VK_PATH = BASE_DIR / "verification_key.json"

if not VK_PATH.exists():
    print("WARNING: verification_key.json not found. Run circuit/setup.sh first.")
    VERIFICATION_KEY = None
else:
    with open(VK_PATH) as f:
        VERIFICATION_KEY = json.load(f)
    print(f"Verification key loaded from {VK_PATH}")


JS_VERIFY = """
const snarkjs = require("snarkjs");
const fs = require("fs");

const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

snarkjs.groth16.verify(data.vk, data.publicSignals, data.proof)
    .then(valid => {
        console.log(JSON.stringify({ valid }));
        process.exit(0);
    })
    .catch(e => {
        console.log(JSON.stringify({ valid: false, error: e.message }));
        process.exit(0);
    });
"""


def verify_groth16_proof(proof: dict, public_signals: list) -> dict:
    if VERIFICATION_KEY is None:
        raise HTTPException(status_code=503, detail="Verification key not loaded.")

    node_exe = shutil.which("node") or "node"

    data_file = None
    js_file = None

    try:
        # Write data to temp JSON file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump({
                "vk": VERIFICATION_KEY,
                "publicSignals": public_signals,
                "proof": proof,
            }, f)
            data_file = f.name

        # Write JS script to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False, encoding='utf-8') as f:
            f.write(JS_VERIFY)
            js_file = f.name

        print(f"[DEBUG] node: {node_exe}")
        print(f"[DEBUG] cwd: {BASE_DIR}")
        print(f"[DEBUG] data_file: {data_file}")

        result = subprocess.run(
            [node_exe, js_file, data_file],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(BASE_DIR),
        )

        print(f"[DEBUG] returncode: {result.returncode}")
        print(f"[DEBUG] stdout: {result.stdout.strip()}")
        print(f"[DEBUG] stderr: {result.stderr.strip()}")

        if result.returncode != 0:
            return {"verified": False, "error": result.stderr.strip()}

        stdout = result.stdout.strip()
        if not stdout:
            return {"verified": False, "error": "No output from Node.js verifier"}

        output = json.loads(stdout)
        return {"verified": bool(output.get("valid", False))}

    except subprocess.TimeoutExpired:
        return {"verified": False, "error": "Verification timed out"}
    except Exception as e:
        return {"verified": False, "error": str(e)}
    finally:
        if data_file and os.path.exists(data_file):
            os.unlink(data_file)
        if js_file and os.path.exists(js_file):
            os.unlink(js_file)


class VerifyRequest(BaseModel):
    proof: dict
    publicSignals: list


@app.get("/")
def root():
    return {
        "service": "ZK Age Proof Verifier",
        "version": "2.0.0",
        "vk_loaded": VERIFICATION_KEY is not None,
        "protocol": "Groth16",
        "curve": "BN128",
    }


@app.get("/vk-info")
def vk_info():
    if VERIFICATION_KEY is None:
        raise HTTPException(status_code=503, detail="Verification key not loaded")
    return {
        "protocol": VERIFICATION_KEY.get("protocol"),
        "curve": VERIFICATION_KEY.get("curve"),
        "nPublic": VERIFICATION_KEY.get("nPublic"),
        "threshold": 18,
        "circuit": "age_check",
    }


@app.post("/verify")
def verify(req: VerifyRequest):
    print(f"[REQ] publicSignals: {req.publicSignals}")
    print(f"[REQ] proof keys: {list(req.proof.keys())}")

    if not req.publicSignals or len(req.publicSignals) != 1:
        raise HTTPException(status_code=400, detail="publicSignals must have exactly 1 element")

    threshold = int(req.publicSignals[0])
    if threshold != 18:
        raise HTTPException(status_code=400, detail="Invalid threshold")

    result = verify_groth16_proof(req.proof, req.publicSignals)

    return {
        **result,
        "statement": f"Prover knows age >= {threshold}",
        "protocol": "Groth16",
        "curve": "BN128",
        "zero_knowledge": True,
        "what_server_learned": f"age >= {threshold}: {result['verified']}",
        "what_server_did_not_learn": "the actual age or birthdate",
    }
