require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

async function run() {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await res.json();
    console.log("Models:", data.models.map(m => m.name));
  } catch(e) {
    console.error(e);
  }
}
run();
