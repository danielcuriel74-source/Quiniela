import React, { useState, useEffect } from 'react';
import { auth, db } from './firebaseConfig';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, setDoc, query, orderBy, where, getDocs, writeBatch } from 'firebase/firestore';

const translations = {
  es: {
    title: 'QUINIELA',
    save: 'Guardar',
    random: 'Al Azar',
    edit: 'Editar',
    viewComparative: 'Ganadores',
    backToMatch: 'Volver a Partido',
    logout: 'Salir',
    matches: 'PARTIDOS',
    comparativeSheet: 'Hoja Comparativa',
    loadingMatches: 'Cargando partidos...',
    rowNum: '#',
    matchHeader: 'PARTIDO',
    local: 'Local',
    visitor: 'Vis.',
    draw: 'Empate',
    finished: '(FINALIZADO)',
    welcomeTitle: 'Quiniela App',
    welcomeDesc: 'Demuestra quién sabe más de fútbol en la oficina',
    loginButton: 'Entrar con Google',
    loginFirst: 'Inicia sesión primero',
    noPredictions: 'No hay pronósticos seleccionados.',
    saveSuccess: '¡Pronósticos guardados!',
    saveError: 'Error al guardar: ',
    loading: 'Cargando...',
    viewWinners: 'Ver Ganadores',
    winnerLabel: 'Ganador',
    winnersLabel: 'Ganadores',
    andJoiner: 'y',
    noPointsYet: 'Sin puntos aún.',
    withPoints: 'con {pts} puntos',
    seeMySheet: 'Ver mi hoja',
    clickToSeeWinner: 'Clic para ver hoja del ganador'
  },
  en: {
    title: 'QUINIELA',
    save: 'Save',
    random: 'Random',
    edit: 'Edit',
    viewComparative: 'Winners',
    backToMatch: 'Back to Match',
    logout: 'Logout',
    matches: 'MATCHES',
    comparativeSheet: 'Comparative Sheet',
    loadingMatches: 'Loading matches...',
    rowNum: '#',
    matchHeader: 'MATCH',
    local: 'Home',
    visitor: 'Away',
    draw: 'Draw',
    finished: '(FINISHED)',
    welcomeTitle: 'Quiniela App',
    welcomeDesc: 'Show who knows more in the office',
    loginButton: 'Sign in with Google',
    loginFirst: 'Log in first',
    noPredictions: 'No predictions selected.',
    saveSuccess: 'Predictions saved!',
    saveError: 'Save error: ',
    loading: 'Loading...',
    viewWinners: 'View Winners',
    winnerLabel: 'Winner',
    winnersLabel: 'Winners',
    andJoiner: 'and',
    noPointsYet: 'No points yet.',
    withPoints: 'with {pts} points',
    seeMySheet: 'See my sheet',
    clickToSeeWinner: 'Click to see winner sheet'
  }
};

function App() {
  // Función para determinar si un partido ya no se puede editar
  const isLocked = (partido) => {
    if (!partido.utcDate) return false;
    const matchTime = new Date(partido.utcDate).getTime();
    const now = Date.now();
    // Bloquear si faltan menos de 15 minutos (900,000 ms) o ya empezó
    return (matchTime - now) < 15 * 60 * 1000;
  };

  const [user, setUser] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [partidos, setPartidos] = useState([]);
  const [predicciones, setPredicciones] = useState({});
  const [puntos, setPuntos] = useState({});
  const [ranking, setRanking] = useState([]);
  const [vista, setVista] = useState('jornada');
  const [modoEdicion, setModoEdicion] = useState(false);
  const [idVisualizado, setIdVisualizado] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [idioma, setIdioma] = useState(navigator.language.startsWith('es') ? 'es' : 'en');

  const t = translations[idioma];

  // Manejar autenticación y registro de usuario
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setIdVisualizado(currentUser.uid);
        // Asegurar que el usuario esté en la base de datos
        await setDoc(doc(db, "usuarios", currentUser.uid), {
          name: currentUser.displayName
        }, { merge: true });
      } else {
        setUser(null);
        setIdVisualizado(null);
      }
      setCargando(false); // Ya terminamos de verificar
    });

    return () => unsubscribe();
  }, []);

  // Leer las predicciones guardadas del usuario para mostrarlas en las "hojas"
  useEffect(() => {
    if (!idVisualizado) {
      setPredicciones({});
      return;
    }
    const q = query(collection(db, 'predicciones'), where('userId', '==', idVisualizado));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pMap = {};
      // Si no hay predicciones, activamos el modo edición automáticamente
      if (snapshot.empty) {
        setModoEdicion(true);
      }
      
      const ptsMap = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        let seleccion = '';
        // Mapear scores a 1, X, 2 para la UI
        if (data.homeScore > data.awayScore) seleccion = '1';
        else if (data.homeScore < data.awayScore) seleccion = '2';
        else if (data.homeScore === data.awayScore && data.homeScore !== undefined) seleccion = 'X';
        
        pMap[data.matchId] = seleccion;
        ptsMap[data.matchId] = data.pointsEarned || 0;
      });
      setPredicciones(pMap);
      setPuntos(ptsMap);
    });
    return () => unsubscribe();
  }, [idVisualizado]);

  // Leer los partidos de la base de datos en tiempo real
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'partidos'), (snapshot) => {
      const matchesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPartidos(matchesData);
    }, (error) => {
      console.error("Error Firestore:", error);
    });
    return () => unsubscribe();
  }, []);

  // Leer el ranking de usuarios
  useEffect(() => {
    const q = query(collection(db, 'usuarios'), orderBy('totalPoints', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRanking(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  const loginConGoogle = async () => {
    const provider = new GoogleAuthProvider();
    // Forzar la selección de cuenta evita cierres automáticos sospechosos
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      // Forzamos el guardado del usuario inmediatamente
      await setDoc(doc(db, "usuarios", user.uid), {
        name: user.displayName
      }, { merge: true });
      
    } catch (error) {
      console.error("Detalle del error:", error);
      if (error.code === 'auth/operation-not-allowed') {
        alert("Error: Debes habilitar Google en la consola de Firebase (Authentication > Sign-in method)");
      } else if (error.code === 'auth/unauthorized-domain') {
        alert("Error: Este dominio (localhost o la URL actual) no está autorizado en la consola de Firebase (Authentication > Settings > Authorized domains).");
      } else {
        alert("Error al entrar (" + error.code + "): " + error.message);
      }
    }
  };

  const guardarTodosLosPronosticos = async () => {
    if (!user || isSaving) return;
    setIsSaving(true);

    try {
      const currentMatchIds = partidos.map(p => p.id);
      
      // 1. Borrar predicciones huérfanas
      const q = query(collection(db, 'predicciones'), where('userId', '==', user.uid));
      const snap = await getDocs(q);
      const deleteBatch = writeBatch(db);
      snap.forEach(d => {
        if (!currentMatchIds.includes(d.data().matchId)) deleteBatch.delete(d.ref);
      });
      await deleteBatch.commit();

      // 2. Guardar las actuales en fragmentos (chunks) para no exceder los límites de las reglas
      const idsToSave = Object.keys(predicciones).filter(id => currentMatchIds.includes(id));
      if (idsToSave.length === 0) {
        alert(t.noPredictions);
        setIsSaving(false);
        return;
      }

      // Dividimos en grupos de 15 para estar seguros (límite de reglas es 20)
      for (let i = 0; i < idsToSave.length; i += 15) {
        const chunk = idsToSave.slice(i, i + 15);
        const batch = writeBatch(db);

        chunk.forEach(id => {
          const partido = partidos.find(p => p.id === id);
          if (partido && isLocked(partido)) return;

          const sel = predicciones[id];
          let homeScore = 0, awayScore = 0;
          if (sel === '1') { homeScore = 1; awayScore = 0; }
          else if (sel === 'X') { homeScore = 1; awayScore = 1; }
          else if (sel === '2') { homeScore = 0; awayScore = 1; }

          batch.set(doc(db, "predicciones", `${user.uid}_${id}`), {
            userId: user.uid,
            userName: user.displayName,
            matchId: id,
            homeScore: homeScore,
            awayScore: awayScore,
            processed: false,
            pointsEarned: 0
          });
        });
        await batch.commit();
      }

      alert(t.saveSuccess);
      setModoEdicion(false); // El botón cambiará automáticamente a "Editar"
    } catch (e) {
      alert(t.saveError + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Desactivar modo edición si estamos viendo a otro usuario
  useEffect(() => {
    if (user && idVisualizado !== user.uid) {
      setModoEdicion(false);
    }
  }, [idVisualizado, user]);

  const seleccionarAlAzar = () => {
    if (!modoEdicion) return;
    const nuevas = { ...predicciones };
    partidos.forEach(p => {
      if (isLocked(p)) return; // No cambiar partidos bloqueados
      const opts = ['1', 'X', '2'];
      nuevas[p.id] = opts[Math.floor(Math.random() * 3)];
    });
    setPredicciones(nuevas);
  };

  // Lógica para obtener el mensaje de ganadores para mostrar en la interfaz
  const maxPoints = ranking.length > 0 ? (ranking[0].totalPoints || 0) : 0;
  const winners = ranking.filter(u => u.totalPoints === maxPoints && maxPoints > 0);
  const winnersList = winners.map(u => u.name);
  const winnerMessage = maxPoints === 0 
    ? t.noPointsYet 
    : `${winnersList.length === 1 ? t.winnerLabel : t.winnersLabel}: ${winnersList.length === 1 ? winnersList[0] : `${winnersList.slice(0, -1).join(', ')} ${t.andJoiner} ${winnersList.slice(-1)}`} ${t.withPoints.replace('{pts}', maxPoints)}`;

  return (
    <div style={{ 
      fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif', 
      minHeight: '100vh', 
      margin: 0, 
      backgroundImage: 'linear-gradient(rgba(244, 247, 246, 0.6), rgba(244, 247, 246, 0.6)), url("https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQfzl0bxal8YjH1V5VJxAgt4_CkH30BRx6bCQ&s")',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed'
    }}>
      {cargando ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#2c3e50' }}><h2>Cargando...</h2></div>
      ) : user ? (
        <div style={{ width: '100%', minHeight: '100vh' }}>
          <header style={{ 
            position: 'sticky', 
            top: 0, 
            zIndex: 100, 
            backgroundColor: '#004a99', 
            color: 'white', 
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)', 
            width: '100%',
            padding: '8px 15px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1200px', margin: '0 auto' }}>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div onClick={() => { setVista('jornada'); setIdVisualizado(user.uid); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <img 
                    src="https://i.pinimg.com/736x/63/5d/5f/635d5f83049f08c3926756a234c206fb.jpg" 
                    alt="Logo" 
                    style={{ width: '26px', height: '26px', borderRadius: '50%', border: '1px solid white' }} 
                  />
                  <h1 style={{ margin: 0, fontSize: '0.85rem', letterSpacing: '1px', fontWeight: '800' }}>{t.title}</h1>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderLeft: '1px solid rgba(255,255,255,0.3)', paddingLeft: '10px' }}>
                  <span style={{ fontSize: '0.75rem' }}>{user.displayName}</span>
                  {idVisualizado !== user.uid && (
                    <button 
                      onClick={() => setIdVisualizado(user.uid)}
                      style={{ 
                        backgroundColor: '#f1c40f', color: '#2c3e50', border: 'none', 
                        padding: '2px 8px', borderRadius: '10px', fontSize: '0.6rem', 
                        fontWeight: 'bold', cursor: 'pointer' 
                      }}
                    >
                      {t.seeMySheet}
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button onClick={() => setVista(vista === 'jornada' ? 'comparativa' : 'jornada')} style={{ backgroundColor: '#f1c40f', color: '#2c3e50', border: 'none', padding: '4px 10px', borderRadius: '15px', fontSize: '0.65rem', fontWeight: 'bold', cursor: 'pointer' }}>
                  {vista === 'jornada' ? t.viewComparative : t.backToMatch}
                </button>
                <button onClick={() => setIdioma(idioma === 'es' ? 'en' : 'es')} style={{ backgroundColor: 'transparent', border: '1px solid white', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '0.6rem', cursor: 'pointer' }}>
                  {idioma.toUpperCase()}
                </button>
                <button 
                  onClick={() => signOut(auth)} 
                  style={{ backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.5)', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer' }}
                >
                  Salir
                </button>
              </div>

            </div>
          </header>

          <div style={{ maxWidth: '500px', margin: '20px auto', padding: '0 10px' }}>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #ddd', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #004a99', paddingBottom: '10px' }}>
                <div style={{ width: '80px' }}>
                  {vista === 'jornada' && idVisualizado === user.uid && (
                    <button 
                      onClick={seleccionarAlAzar} 
                      disabled={!modoEdicion}
                      style={{ backgroundColor: '#9b59b6', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold', cursor: modoEdicion ? 'pointer' : 'default', opacity: modoEdicion ? 1 : 0.5 }}
                    >
                      {t.random}
                    </button>
                  )}
                </div>
                <h3 style={{ color: '#004a99', margin: 0, textTransform: 'uppercase', fontSize: '0.85rem', letterSpacing: '1px' }}>
                  {vista === 'jornada' 
                    ? t.matches 
                    : (idVisualizado !== user?.uid ? `${t.comparativeSheet} (${ranking.find(r => r.id === idVisualizado)?.name || '...'})` : t.comparativeSheet)}
                </h3>
                <div style={{ width: '80px', textAlign: 'right' }}>
                  {vista === 'jornada' && idVisualizado === user.uid && (modoEdicion ? (
                    <button onClick={guardarTodosLosPronosticos} disabled={isSaving} style={{ backgroundColor: '#27ae60', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold', cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1 }}>
                      {t.save}
                    </button>
                  ) : (
                    <button onClick={() => setModoEdicion(true)} style={{ backgroundColor: '#3498db', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 'bold', cursor: 'pointer' }}>
                      {t.edit}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sección de Ganadores dentro de la hoja comparativa */}
              {vista === 'comparativa' && (
                <div style={{ 
                  textAlign: 'center', marginBottom: '20px', padding: '10px',
                  backgroundColor: '#fff9c4', borderRadius: '8px', border: '1px solid #fbc02d',
                  fontSize: '0.8rem', fontWeight: 'bold', color: '#856404',
                  cursor: winners.length > 0 ? 'pointer' : 'default'
                }}
                onClick={() => winners.length > 0 && setIdVisualizado(winners[0].id)}
                title={t.clickToSeeWinner}
                >
                  🏆 {winnerMessage}
                </div>
              )}

              {partidos.length === 0 && <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#999' }}>Cargando partidos...</p>}
              <div style={{ border: '1px solid #eee', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: vista === 'jornada' ? '25px 35px 1fr 35px 35px 35px 1fr 35px' : '25px 1.2fr 60px 1.2fr 40px', backgroundColor: '#004a99', color: 'white', padding: '5px', fontSize: '0.6rem', fontWeight: 'bold', textAlign: 'center' }}>
                  <div>{t.rowNum}</div>
                  {vista === 'jornada' ? (
                    <><div /><div>{t.local}</div><div>1</div><div>X</div><div>2</div><div>{t.visitor}</div><div /></>
                  ) : (
                    <><div>{t.matchHeader}</div><div>RES.</div><div>PRED.</div><div>PTS</div></>
                  )}
                </div>

                {partidos.map((partido, index) => (
                  <div key={partido.id} style={{ 
                    display: 'grid', 
                    gridTemplateColumns: vista === 'jornada' ? '25px 35px 1fr 35px 35px 35px 1fr 35px' : '25px 1.2fr 60px 1.2fr 40px', 
                    alignItems: 'center', 
                    padding: '6px 4px', 
                    borderBottom: index === partidos.length - 1 ? 'none' : '1px solid #eee',
                    backgroundColor: index % 2 === 0 ? '#fff' : '#f9f9f9',
                    fontSize: '0.7rem'
                  }}>
                    <div style={{ color: isLocked(partido) ? '#e74c3c' : '#999', textAlign: 'center', fontWeight: 'bold' }}>
                      {isLocked(partido) ? '🔒' : index + 1}
                    </div>
                    {vista === 'jornada' ? (
                      <>
                        <div onClick={() => modoEdicion && !isLocked(partido) && setPredicciones({...predicciones, [partido.id]: '1'})} style={{ height: '22px', border: '1px solid #004a99', borderRadius: '3px', cursor: modoEdicion && !isLocked(partido) ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: predicciones[partido.id] === '1' ? '#004a99' : 'white', color: predicciones[partido.id] === '1' ? 'white' : '#004a99', fontWeight: 'bold', opacity: isLocked(partido) && modoEdicion ? 0.4 : (!modoEdicion && predicciones[partido.id] !== '1' ? 0.6 : 1) }}>1</div>
                        <div style={{ textAlign: 'left', fontWeight: 'bold', paddingLeft: '5px' }}>{partido.homeTeam}</div>
                        <div style={{ visibility: 'hidden' }}>1</div> {/* Spacer */}
                        <div onClick={() => modoEdicion && !isLocked(partido) && setPredicciones({...predicciones, [partido.id]: 'X'})} style={{ height: '22px', border: '1px solid #004a99', borderRadius: '3px', cursor: modoEdicion && !isLocked(partido) ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: predicciones[partido.id] === 'X' ? '#004a99' : 'white', color: predicciones[partido.id] === 'X' ? 'white' : '#004a99', fontWeight: 'bold', opacity: isLocked(partido) && modoEdicion ? 0.4 : (!modoEdicion && predicciones[partido.id] !== 'X' ? 0.6 : 1) }}>X</div>
                        <div style={{ visibility: 'hidden' }}>2</div> {/* Spacer */}
                        <div style={{ textAlign: 'right', fontWeight: 'bold', paddingRight: '5px' }}>{partido.awayTeam}</div>
                        <div onClick={() => modoEdicion && !isLocked(partido) && setPredicciones({...predicciones, [partido.id]: '2'})} style={{ height: '22px', border: '1px solid #004a99', borderRadius: '3px', cursor: modoEdicion && !isLocked(partido) ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: predicciones[partido.id] === '2' ? '#004a99' : 'white', color: predicciones[partido.id] === '2' ? 'white' : '#004a99', fontWeight: 'bold', opacity: isLocked(partido) && modoEdicion ? 0.4 : (!modoEdicion && predicciones[partido.id] !== '2' ? 0.6 : 1) }}>2</div>
                      </>
                    ) : (
                      <>
                        <div style={{ textAlign: 'left', paddingLeft: '5px' }}>{partido.homeTeam}-{partido.awayTeam}</div>
                        <div style={{ textAlign: 'center', fontWeight: '800' }}>{partido.homeScore !== undefined ? `${partido.homeScore}-${partido.awayScore}` : '-'}</div>
                        <div style={{ textAlign: 'center', color: '#004a99', fontWeight: 'bold' }}>{predicciones[partido.id] === '1' ? partido.homeTeam : predicciones[partido.id] === '2' ? partido.awayTeam : predicciones[partido.id] === 'X' ? t.draw : '-'}</div>
                        <div style={{ textAlign: 'center', fontWeight: 'bold', color: (puntos[partido.id] || 0) > 0 ? '#27ae60' : '#e74c3c' }}>{puntos[partido.id] || 0}</div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100vh', 
          backgroundImage: 'linear-gradient(rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.8)), url("https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQfzl0bxal8YjH1V5VJxAgt4_CkH30BRx6bCQ&s")',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          color: 'white',
          textAlign: 'center'
        }}>
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)', padding: '50px', borderRadius: '20px', backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)', border: '1px solid rgba(255, 255, 255, 0.18)' }}>
            <img 
              src="https://i.pinimg.com/736x/63/5d/5f/635d5f83049f08c3926756a234c206fb.jpg" 
              alt="Logo" 
              style={{ width: '120px', height: '120px', borderRadius: '50%', marginBottom: '20px', border: '4px solid white', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }} 
            />
            <h1 style={{ fontSize: '3rem', marginBottom: '10px' }}>Quiniela App</h1>
            <p style={{ fontSize: '1.2rem', marginBottom: '30px', opacity: 0.9 }}>Demuestra quién sabe más de fútbol en la oficina</p>
            <button onClick={loginConGoogle} style={{ padding: '15px 30px', fontSize: '18px', cursor: 'pointer', backgroundColor: '#ffffff', color: '#2a5298', border: 'none', borderRadius: '30px', fontWeight: 'bold', boxShadow: '0 4px 15px rgba(0,0,0,0.2)', transition: 'transform 0.2s' }}>
              Entrar con Google
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;