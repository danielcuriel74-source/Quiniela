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
  const API_KEY = process.env.FOOTBALL_API_KEY || '7ede1dc3949448858158e83d3202f492';
  const COMPETITION = 'WC'; // 'WC' para el Mundial

  const res = await axios.get(`https://api.football-data.org/v4/competitions/${COMPETITION}/matches`, {
    headers: { 'X-Auth-Token': API_KEY }
  });

  const finishedMatches = res.data.matches.filter(m => m.status === 'FINISHED');

  for (const match of finishedMatches) {
    const matchId = match.id.toString();
    const { homeTeam, awayTeam, score } = match;
    const realHome = score.fullTime.home;
    const realAway = score.fullTime.away;

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
    
    for (const doc of preds.docs) {
      const data = doc.data();
      let points = 0;
      if (data.homeScore === realHome && data.awayScore === realAway) points = 3;
      else if (Math.sign(data.homeScore - data.awayScore) === Math.sign(realHome - realAway)) points = 1;

      // Actualizar la predicción
      await doc.ref.update({ pointsEarned: points, processed: true });

      if (points === 0) continue;

      // Actualizar el acumulado del usuario
      await db.collection('usuarios').doc(data.userId).set({
        totalPoints: admin.firestore.FieldValue.increment(points)
      }, { merge: true });
    }
  }
}
updateScores().catch(console.error);