import { useState, useEffect, useRef } from "react";

const API = "http://localhost:8000";
const THRESHOLD = 18;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function computeAge(birthDateStr) {
  const birth = new Date(birthDateStr);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function Step({ n, label, active, done, error }) {
  return (
    <div className={`step ${active?"active":""} ${done?"done":""} ${error?"error":""}`}>
      <div className="step-circle">
        {error ? "✗" : done ? "✓" : n}
      </div>
      <span>{label}</span>
    </div>
  );
}

function ProofField({ label, value, delay: d = 0 }) {
  const [vis, setVis] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVis(true), d); return () => clearTimeout(t); }, [d]);
  const short = value ? (value.length > 20 ? value.slice(0, 10) + "…" + value.slice(-8) : value) : "";
  return (
    <div className={`pf ${vis?"vis":""}`}>
      <span className="pf-label">{label}</span>
      <span className="pf-val mono">{short}</span>
    </div>
  );
}

function CheckRow({ label, ok, delay: d = 0 }) {
  const [vis, setVis] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVis(true), d); return () => clearTimeout(t); }, [d]);
  return (
    <div className={`check-row ${vis?"vis":""} ${ok?"ok":"fail"}`}>
      <span>{ok ? "✓" : "✗"}</span>
      <span>{label}</span>
    </div>
  );
}

function Particles() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current, ctx = c.getContext("2d");
    let W, H, pts = [], id;
    const resize = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
    resize(); addEventListener("resize", resize);
    for (let i = 0; i < 55; i++)
      pts.push({ x: Math.random()*W, y: Math.random()*H, r: Math.random()*1.3+0.3,
        vx: (Math.random()-.5)*.25, vy: (Math.random()-.5)*.25, a: Math.random()*.4+.1 });
    const draw = () => {
      ctx.clearRect(0,0,W,H);
      pts.forEach(p => {
        p.x=(p.x+p.vx+W)%W; p.y=(p.y+p.vy+H)%H;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(26,122,110,${p.a * 0.4})`; ctx.fill();
      });
      for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++) {
        const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.sqrt(dx*dx+dy*dy);
        if(d<110){ ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
          ctx.strokeStyle=`rgba(26,122,110,${.04*(1-d/110)})`; ctx.lineWidth=.5; ctx.stroke(); }
      }
      id = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(id); removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0}} />;
}

export default function App() {
  const [phase, setPhase]         = useState("idle");
  const [birthDate, setBirthDate] = useState("");
  const [proofData, setProofData] = useState(null);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);
  const [log, setLog]             = useState([]);
  const [showMath, setShowMath]   = useState(false);
  const [vkInfo, setVkInfo]       = useState(null);
  const termRef = useRef(null);

  const addLog = (msg, type="") => setLog(p => [...p, {msg, type}]);

  useEffect(() => {
    fetch(`${API}/vk-info`).then(r=>r.json()).then(setVkInfo).catch(()=>{});
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [log]);

  const run = async () => {
    if (!birthDate) return;
    setError(null); setProofData(null); setResult(null); setLog([]);
    const age = computeAge(birthDate);

    setPhase("loading_wasm");
    addLog("$ Initializing snarkjs (Groth16 / BN128)...");
    await delay(300);
    addLog("$ Loading WASM prover circuit (age_check.wasm)...");
    await delay(400);
    addLog("$ Loading proving key (circuit_final.zkey)...");
    await delay(400);

    let snarkjs;
    try {
      snarkjs = window.snarkjs;
      if (!snarkjs) throw new Error("snarkjs not loaded - check index.html CDN script");
    } catch (e) {
      setError(`Failed to load snarkjs: ${e.message}`);
      setPhase("idle");
      return;
    }

    setPhase("proving");
    addLog(`$ Private witness: age = ${age} (stays in browser)`);
    addLog(`$ Public input: threshold = ${THRESHOLD}`);
    await delay(300);
    addLog("$ Computing R1CS witness...");
    await delay(200);
    addLog("$ Running Groth16 prover (BN128 elliptic curve)...");

    let proof, publicSignals;
    const t0 = performance.now();
    try {
      const result = await snarkjs.groth16.fullProve(
        { age: age, threshold: THRESHOLD },
        "/age_check.wasm",
        "/circuit_final.zkey"
      );
      proof = result.proof;
      publicSignals = result.publicSignals;
    } catch (e) {
      if (age < THRESHOLD) {
        addLog(`$ No valid witness exists for age=${age} < ${THRESHOLD}`, "red");
        addLog("$ Proof generation FAILED - circuit constraint violated", "red");
        setResult({ verified: false, under18: true });
        setPhase("result");
        return;
      }
      setError(`Proof generation failed: ${e.message}`);
      setPhase("idle");
      return;
    }
    const proofMs = Math.round(performance.now() - t0);

    setProofData({ proof, publicSignals });
    addLog(`$ Proof generated in ${proofMs}ms`, "green");
    addLog(`$ Proof size: ~256 bytes (3 BN128 curve points)`);
    addLog(`$ Public signal: threshold = ${publicSignals[0]}`);
    addLog(`$ Private witness: age - NOT included in proof`, "dim");
    await delay(400);

    setPhase("verifying");
    addLog("$ -----------------------------------------");
    addLog("$ Sending proof to verifier (server)...");
    addLog(`$ Payload: { proof: {...}, publicSignals: ["${THRESHOLD}"] }`);
    await delay(400);
    addLog("$ Server running: e(A,B) = e(a,b) * e(sum_i w_i*IC_i, g) * e(C,d)");
    await delay(300);

    let verifyResult;
    try {
      const res = await fetch(`${API}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof, publicSignals }),
      });
      verifyResult = await res.json();
    } catch (e) {
      setError(`Verification request failed: ${e.message}`);
      setPhase("idle");
      return;
    }

    addLog(
      verifyResult.verified
        ? "$ Pairing check PASSED - proof is valid"
        : "$ Pairing check FAILED - proof is invalid",
      verifyResult.verified ? "green" : "red"
    );

    setResult(verifyResult);
    setPhase("result");
  };

  const reset = () => {
    setPhase("idle"); setBirthDate(""); setProofData(null);
    setResult(null); setError(null); setLog([]); setShowMath(false);
  };

  const isRunning = ["loading_wasm","proving","verifying"].includes(phase);

  return (
    <>
      <Particles />
      <div className="layout">

        <header>
          <div className="badges">
            <span className="badge">GROTH16</span>
            <span className="badge gold">BN128</span>
            <span className="badge teal">zk-SNARK</span>
          </div>
          <h1>Zero-Knowledge<br/><em>Age Verification</em></h1>
          <p className="subtitle">
            Proof generated <strong>entirely in your browser</strong> using snarkjs + WASM.<br/>
            The server receives a 256-byte proof - never your age or birthdate.
          </p>
        </header>

        <div className="steps">
          <Step n={1} label="Enter birthday" done={phase!=="idle"} active={phase==="idle"} />
          <div className="step-line"/>
          <Step n={2} label="Generate proof" done={["verifying","result"].includes(phase)}
            active={["loading_wasm","proving"].includes(phase)} />
          <div className="step-line"/>
          <Step n={3} label="Server verifies" done={phase==="result"}
            active={phase==="verifying"}
            error={phase==="result" && result && !result.verified} />
        </div>

        <div className="grid">

          <div className="panel">
            <div className="panel-hd">
              <h2>Prover</h2>
              <span className="tag">BROWSER</span>
            </div>

            <div className="field">
              <label>Date of Birth</label>
              <input type="date" value={birthDate}
                onChange={e => setBirthDate(e.target.value)}
                max={new Date().toISOString().split("T")[0]}
                disabled={isRunning} />
              <p className="hint">
                Used only to compute age locally.<br/>
                <strong>Never sent to the server.</strong>
              </p>
            </div>

            {phase === "idle" && (
              <button className="btn-main" onClick={run} disabled={!birthDate}>
                Generate ZK Proof
              </button>
            )}
            {isRunning && (
              <div className="spinner-row">
                <div className="spinner"/>
                <span>
                  {phase==="loading_wasm" ? "Loading WASM circuit..."
                   : phase==="proving" ? "Proving in browser..."
                   : "Verifying on server..."}
                </span>
              </div>
            )}
            {phase === "result" && (
              <button className="btn-ghost" onClick={reset}>Try Again</button>
            )}
            {error && <div className="err">{error}</div>}

            {proofData && (
              <div className="proof-box">
                <div className="sec-title">
                  Proof <span className="tag-sm">256 bytes</span>
                </div>
                <ProofField label="pi_A (G1)" value={proofData.proof.pi_a?.[0]} delay={0} />
                <ProofField label="pi_B (G2)" value={proofData.proof.pi_b?.[0]?.[0]} delay={100} />
                <ProofField label="pi_C (G1)" value={proofData.proof.pi_c?.[0]} delay={200} />
                <ProofField label="Public: threshold" value={proofData.publicSignals?.[0]} delay={300} />
                <div className="proof-note">
                  age is <span className="red-text">not</span> in this payload
                </div>
              </div>
            )}

            <div className="info-box">
              <div className="sec-title">What happens here</div>
              <div className="info-row">
                <span className="info-n">1</span>
                <span>Browser computes <code>age</code> from your birthdate</span>
              </div>
              <div className="info-row">
                <span className="info-n">2</span>
                <span>snarkjs generates a Groth16 proof that <code>age ≥ 18</code></span>
              </div>
              <div className="info-row">
                <span className="info-n">3</span>
                <span>Only the proof + <code>threshold=18</code> leaves your browser</span>
              </div>
              <div className="info-row">
                <span className="info-n">4</span>
                <span>Server verifies the pairing equation</span>
              </div>
            </div>
          </div>

          <div className="panel terminal-panel">
            <div className="term-hd">
              <span className="dot red"/><span className="dot yellow"/><span className="dot green"/>
              <span className="term-title">snarkjs - groth16 prover</span>
            </div>
            <div className="terminal" ref={termRef}>
              {log.length === 0 && <div className="tl dim">$ waiting for input...</div>}
              {log.map((l, i) => (
                <div key={i} className={`tl ${l.type}`}>{l.msg}</div>
              ))}
              {isRunning && <div className="tl blink">$ _</div>}
            </div>

            {phase === "result" && result && (
              <div className={`result ${result.verified?"ok":"fail"}`}>
                <div className="result-icon">{result.verified ? "✓" : "✗"}</div>
                <div className="result-title">
                  {result.verified ? "Proof Verified" : "Proof Invalid"}
                </div>
                <div className="result-sub">
                  {result.verified
                    ? "age >= 18 confirmed via Groth16 pairing check"
                    : result.under18
                      ? "No valid witness for age < 18 - circuit constraint violated"
                      : "The pairing check failed"}
                </div>
                <div className="result-checks">
                  <CheckRow label="snarkjs proof generated" ok={!!proofData || result.under18===true && false} delay={0} />
                  <CheckRow label="age NOT sent to server" ok={true} delay={100} />
                  <CheckRow label="Groth16 pairing verified" ok={!!result.verified} delay={200} />
                  <CheckRow label="Public input: threshold=18" ok={true} delay={300} />
                </div>
                {result.verified && (
                  <div className="vk-note">
                    Verified using: {vkInfo?.protocol?.toUpperCase()} on {vkInfo?.curve?.toUpperCase()}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-hd">
              <h2>Verifier</h2>
              <span className="tag gold">SERVER</span>
            </div>

            <div className="zk-props">
              {[
                ["ZK", "Zero-Knowledge", "Server learns only age >= 18, nothing else"],
                ["C",  "Completeness",   "Honest prover always succeeds"],
                ["S",  "Soundness",      "Forgery requires breaking q-SDH on BN128"],
                ["SN", "Succinctness",   "Proof is 256 bytes regardless of circuit size"],
              ].map(([icon, title, desc]) => (
                <div key={title} className="zk-prop">
                  <div className="prop-icon">{icon}</div>
                  <div><strong>{title}</strong><p>{desc}</p></div>
                </div>
              ))}
            </div>

            {vkInfo && (
              <div className="vk-box">
                <div className="sec-title">Verification Key</div>
                <div className="vk-row"><span>Protocol</span><span className="mono">{vkInfo.protocol}</span></div>
                <div className="vk-row"><span>Curve</span><span className="mono">{vkInfo.curve}</span></div>
                <div className="vk-row"><span>Public inputs</span><span className="mono">{vkInfo.nPublic}</span></div>
                <div className="vk-row"><span>Circuit</span><span className="mono">age_check</span></div>
                <div className="vk-row"><span>Threshold</span><span className="mono">{vkInfo.threshold}</span></div>
              </div>
            )}

            <button className="btn-math" onClick={() => setShowMath(v=>!v)}>
              {showMath ? "Hide" : "Show"} Groth16 Verification Equation
            </button>

            {showMath && (
              <div className="math">
                <div className="math-title">Groth16 Pairing Check</div>
                <div className="math-desc">
                  The verifier checks a single equation involving 3 bilinear pairings
                  on the BN128 elliptic curve. No secret data is needed.
                </div>
                <div className="math-eq">
                  e(A, B) =<br/>
                  &nbsp;&nbsp;e(a, b)<br/>
                  &nbsp;&nbsp;* e(sum_i w_i * IC_i, g)<br/>
                  &nbsp;&nbsp;* e(C, d)
                </div>
                <div className="math-legend">
                  <div><code>A, B, C</code> - proof points (from browser)</div>
                  <div><code>a, b, g, d</code> - from verification key</div>
                  <div><code>w_i</code> - public inputs (threshold=18)</div>
                  <div><code>IC_i</code> - input commitments in vk</div>
                  <div><code>e(.,.) </code> - Ate pairing on BN128</div>
                </div>
                <div className="math-note">
                  The constraint <code>age >= 18</code> is enforced by the R1CS
                  of the Circom circuit. If the constraint is violated, no valid
                  A, B, C exist that satisfy the equation.
                </div>
              </div>
            )}
          </div>

        </div>

        <footer>
          <p>Master's Thesis - Zero-Knowledge Proofs in Digital Identity</p>
          <p className="footer-sub">
            Circom 2.0 · snarkjs · Groth16 · BN128 · Trusted Setup (Powers of Tau)
          </p>
        </footer>
      </div>
    </>
  );
}
