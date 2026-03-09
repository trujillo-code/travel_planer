// @ts-nocheck
import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { auth } from "./firebase";

export default function AuthPage() {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "register") {
        if (!name.trim()) { setError("Ingresa tu nombre"); setLoading(false); return; }
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      const code = err.code;
      if (code === "auth/email-already-in-use") setError("Este email ya está registrado");
      else if (code === "auth/weak-password") setError("La contraseña debe tener al menos 6 caracteres");
      else if (code === "auth/invalid-email") setError("Email inválido");
      else if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found")
        setError("Email o contraseña incorrectos");
      else setError("Error: " + (err.message || code));
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight:"100vh",background:"#F7F4EF",display:"flex",alignItems:"center",justifyContent:"center",
      fontFamily:"'DM Sans',sans-serif",padding:"1rem"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap');
        *{box-sizing:border-box}
        :root{--sand:#F7F4EF;--ink:#1C1C1E;--muted:#8A8580;--accent:#C4622D;--line:rgba(28,28,30,0.1)}
        body{margin:0}
      `}</style>
      <div style={{
        background:"#fff",borderRadius:"16px",padding:"2.5rem",width:"100%",maxWidth:"400px",
        boxShadow:"0 8px 40px rgba(28,28,30,.1)",border:"1px solid rgba(28,28,30,.08)"
      }}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:"2rem"}}>
          <span style={{fontSize:"2.5rem"}}>🧭</span>
          <h1 style={{
            fontFamily:"'Cormorant Garamond',serif",fontSize:"2rem",fontWeight:600,
            margin:".5rem 0 .25rem",color:"#1C1C1E"
          }}>Suavid Travel Planner</h1>
          <p style={{color:"#8A8580",fontSize:".85rem",margin:0}}>
            {mode === "login" ? "Inicia sesión para ver tus viajes" : "Crea tu cuenta para planificar viajes"}
          </p>
        </div>

        {/* Error */}
        {error && <div style={{
          background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:"8px",
          padding:".6rem 1rem",marginBottom:"1rem",color:"#DC2626",fontSize:".8rem"
        }}>{error}</div>}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {mode === "register" && <>
            <label style={{fontSize:".72rem",fontWeight:500,color:"#8A8580",textTransform:"uppercase",letterSpacing:".08em",display:"block",marginBottom:".35rem"}}>Nombre</label>
            <input
              type="text" placeholder="Tu nombre" value={name}
              onChange={e => setName(e.target.value)}
              style={{
                width:"100%",border:"1px solid rgba(28,28,30,.12)",borderRadius:"8px",
                padding:".7rem .9rem",fontSize:".9rem",color:"#1C1C1E",background:"#F7F4EF",
                marginBottom:"1rem",fontFamily:"'DM Sans',sans-serif"
              }}
            />
          </>}

          <label style={{fontSize:".72rem",fontWeight:500,color:"#8A8580",textTransform:"uppercase",letterSpacing:".08em",display:"block",marginBottom:".35rem"}}>Email</label>
          <input
            type="email" placeholder="tu@email.com" value={email}
            onChange={e => setEmail(e.target.value)} required
            style={{
              width:"100%",border:"1px solid rgba(28,28,30,.12)",borderRadius:"8px",
              padding:".7rem .9rem",fontSize:".9rem",color:"#1C1C1E",background:"#F7F4EF",
              marginBottom:"1rem",fontFamily:"'DM Sans',sans-serif"
            }}
          />

          <label style={{fontSize:".72rem",fontWeight:500,color:"#8A8580",textTransform:"uppercase",letterSpacing:".08em",display:"block",marginBottom:".35rem"}}>Contraseña</label>
          <input
            type="password" placeholder="Mínimo 6 caracteres" value={password}
            onChange={e => setPassword(e.target.value)} required minLength={6}
            style={{
              width:"100%",border:"1px solid rgba(28,28,30,.12)",borderRadius:"8px",
              padding:".7rem .9rem",fontSize:".9rem",color:"#1C1C1E",background:"#F7F4EF",
              marginBottom:"1.5rem",fontFamily:"'DM Sans',sans-serif"
            }}
          />

          <button type="submit" disabled={loading} style={{
            width:"100%",background:"#C4622D",border:"none",color:"#fff",
            padding:".75rem",borderRadius:"8px",fontSize:".9rem",fontWeight:500,
            cursor:loading?"wait":"pointer",opacity:loading?.7:1,
            fontFamily:"'DM Sans',sans-serif",transition:"opacity .2s"
          }}>
            {loading ? "Cargando..." : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </form>

        {/* Toggle mode */}
        <div style={{textAlign:"center",marginTop:"1.5rem",fontSize:".82rem",color:"#8A8580"}}>
          {mode === "login" ? (
            <>¿No tienes cuenta?{" "}
              <button onClick={() => {setMode("register");setError("");}} style={{
                background:"none",border:"none",color:"#C4622D",cursor:"pointer",
                fontWeight:500,fontSize:"inherit",fontFamily:"inherit",padding:0
              }}>Regístrate</button>
            </>
          ) : (
            <>¿Ya tienes cuenta?{" "}
              <button onClick={() => {setMode("login");setError("");}} style={{
                background:"none",border:"none",color:"#C4622D",cursor:"pointer",
                fontWeight:500,fontSize:"inherit",fontFamily:"inherit",padding:0
              }}>Inicia sesión</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
