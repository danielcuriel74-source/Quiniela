const admin = require('firebase-admin');
const axios = require('axios');

// Carga la llave de Firebase
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require('./serviceAccountKey.json');
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// 1. Consigue una API KEY gratuita en https://www.football-data.org/
// 2. Pégala aquí abajo:
const API_KEY = process.env.FOOTBALL_API_KEY || '7ede1dc3949448858158e83d3202f492'; 
const COMPETITION = 'WC'; // 'WC' es el Mundial

async function importar() {
  try {
    console.log("🔄 Conectando con la API de fútbol para obtener el calendario...");
    const response = await axios.get(`https://api.football-data.org/v4/competitions/${COMPETITION}/matches`, {
      headers: { 'X-Auth-Token': API_KEY }
    });

    const matches = response.data.matches;
    console.log(`📡 Se encontraron ${matches.length} partidos disponibles.`);

    if (matches.length === 0) {
      console.log("⚠️ La API no devolvió partidos. No se borrará la base de datos actual.");
      return;
    }

    // Borrar partidos viejos SOLO si tenemos nuevos para insertar
    const currentMatches = await db.collection('partidos').get();
    if (!currentMatches.empty) {
      console.log("🗑️ Reemplazando partidos anteriores con datos nuevos...");
      const batch = db.batch();
      currentMatches.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    for (const m of matches) {
      // Solo importamos partidos que tengan equipos definidos
      if (!m.homeTeam?.name || !m.awayTeam?.name) continue;

      const data = {
        homeTeam: m.homeTeam.name,
        awayTeam: m.awayTeam.name,
        fecha: new Date(m.utcDate).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        utcDate: m.utcDate, // Guardar la fecha original para cálculos de bloqueo
        status: m.status,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      };
      // Usamos el ID de la API para que sync.js pueda actualizar los puntos después automáticamente
      await db.collection('partidos').doc(m.id.toString()).set(data);
      console.log(`✅ ${data.homeTeam} vs ${data.awayTeam} importado.`);
    }
    console.log("\n✨ ¡Importación terminada! Entra a tu App para ver las hojas generadas.");
  } catch (e) {
    if (e.message.includes("PERMISSION_DENIED")) {
      console.error("❌ ERROR DE PERMISOS: Debes activar Firestore en la consola de Firebase y crear la base de datos.");
    } else {
      console.error("❌ Error al importar:", e.response?.data?.message || e.message);
    }
  }
}
importar();