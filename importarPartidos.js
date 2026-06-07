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
const API_KEY = process.env.FOOTBALL_API_KEY;
if (!API_KEY) {
  console.error("❌ Error: FOOTBALL_API_KEY no configurada. Si estás en local, usa: $env:FOOTBALL_API_KEY='tu_llave'; node importarPartidos.js");
  process.exit(1);
}
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
    if (!currentMatches.empty && matches.length > 0) {
      console.log(`🗑️ Eliminando ${currentMatches.size} partidos anteriores...`);
      // Firestore tiene un límite de 500 operaciones por batch
      const chunks = [];
      for (let i = 0; i < currentMatches.docs.length; i += 500) {
        chunks.push(currentMatches.docs.slice(i, i + 500));
      }
      for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }

    const insertBatch = db.batch();

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
      const matchRef = db.collection('partidos').doc(m.id.toString());
      insertBatch.set(matchRef, data);
      console.log(`✅ ${data.homeTeam} vs ${data.awayTeam} importado.`);
    }

    await insertBatch.commit();
    console.log("\n✨ ¡Importación terminada exitosamente!");
  } catch (e) {
    if (e.message.includes("PERMISSION_DENIED")) {
      console.error("❌ ERROR DE PERMISOS: Debes activar Firestore en la consola de Firebase y crear la base de datos.");
    } else {
      console.error("❌ Error al importar:", e.response?.data?.message || e.message);
    }
  }
}
importar();