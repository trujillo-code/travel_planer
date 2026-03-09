// @ts-nocheck
import { useState, useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase";
import AuthPage from "./AuthPage";
import TravelPlanner from "./TravelPlanner";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) {
    return (
      <div style={{
        minHeight:"100vh",background:"#F7F4EF",display:"flex",alignItems:"center",
        justifyContent:"center",fontFamily:"'DM Sans',sans-serif",color:"#8A8580"
      }}>
        <div style={{textAlign:"center"}}>
          <span style={{fontSize:"2.5rem"}}>🧭</span>
          <p style={{marginTop:".75rem"}}>Cargando...</p>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  return <TravelPlanner user={user} onSignOut={() => signOut(auth)} />;
}

export default App;
