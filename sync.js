const admin = require('firebase-admin');
const axios = require('axios');

// Soporte para automatización: lee de variable de entorno o archivo local
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require('./serviceAccountKey.json');
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function updateScores() {
  const API_KEY = process.env.FOOTBALL_API_KEY;
  if (!API_KEY) {
    console.error("❌ Error: FOOTBALL_API_KEY no configurada en las variables de entorno.");
    return;
  }
  const COMPETITION = 'WC'; // 'WC' para el Mundial

  const res = await axios.get(`https://api.football-data.org/v4/competitions/${COMPETITION}/matches`, {
    headers: { 'X-Auth-Token': API_KEY }
  });

  if (!res.data || !res.data.matches) {
    console.error("⚠️ No se recibieron partidos de la API.");
    return;
  }

  const finishedMatches = res.data.matches.filter(m => m.status === 'FINISHED' || m.status === 'TIMED');

  for (const match of finishedMatches) {
    const matchId = match.id.toString();
    const { homeTeam, awayTeam, score } = match;
    const realHome = score.fullTime.home ?? 0;
    const realAway = score.fullTime.away ?? 0;

    // Actualizar el resultado real en la colección de partidos para que se vea en la UI
    await db.collection('partidos').doc(matchId).set({
      homeScore: realHome,
      awayScore: realAway,
      status: 'FINISHED'
    }, { merge: true });

    // Solo procesar predicciones que NO han sido puntuadas aún (Evita puntos dobles)
    const preds = await db.collection('predicciones')
      .where('matchId', '==', matchId)
      .where('processed', '==', false)
      .get();
    
    const batch = db.batch();
    let hasUpdates = false;
    let count = 0;

    for (const doc of preds.docs) {
      const data = doc.data();
      let points = 0;
      if (data.homeScore === realHome && data.awayScore === realAway) points = 3;
      else if (Math.sign(data.homeScore - data.awayScore) === Math.sign(realHome - realAway)) points = 1;

      // Actualizar la predicción
      batch.update(doc.ref, { pointsEarned: points, processed: true });
      count++;
      hasUpdates = true;

      if (points === 0) continue;

      // Actualizar el acumulado del usuario
      const userRef = db.collection('usuarios').doc(data.userId);
      batch.set(userRef, {
        totalPoints: admin.firestore.FieldValue.increment(points)
      }, { merge: true });
    }

    if (hasUpdates) {
      await batch.commit();
      console.log(`📊 Se procesaron ${count} predicciones para el partido ${matchId} (${homeTeam.name} vs ${awayTeam.name})`);
    }
  }
}
updateScores().catch(console.error);