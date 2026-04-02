import os
import uuid
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import openai

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])

# In-memory storage: {session_id: [{"transcript": str, "summary": str}]}
sessions: dict[str, list[dict]] = {}


@app.post("/sessions")
def create_session():
    session_id = str(uuid.uuid4())
    sessions[session_id] = []
    return {"session_id": session_id}


@app.post("/segments")
async def process_segment(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    # 1. Přepis přes Whisper
    audio_bytes = await audio.read()
    transcript_response = client.audio.transcriptions.create(
        model="whisper-1",
        file=(audio.filename, audio_bytes, audio.content_type),
        language="cs",
    )
    transcript = transcript_response.text

    # 2. Sumarizace přes GPT-4o mini
    summary = summarize(transcript)

    # 3. Ulož segment
    sessions[session_id].append({"transcript": transcript, "summary": summary})

    return {"transcript": transcript, "summary": summary}


@app.get("/sessions/{session_id}/summary")
def get_session_summary(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    segments = sessions[session_id]
    if not segments:
        return {"summary": "Zatím žádný obsah."}

    all_transcripts = "\n\n".join(
        f"Segment {i+1}: {s['transcript']}" for i, s in enumerate(segments)
    )

    summary = summarize(all_transcripts, full_session=True)
    return {"summary": summary}


def summarize(text: str, full_session: bool = False) -> str:
    if full_session:
        system = "Jsi asistent pro sumarizaci rozhovorů. Vytvoř stručné a přehledné shrnutí celého rozhovoru v češtině. Zaměř se na klíčové body, rozhodnutí a akční body."
        prompt = f"Shrň celý tento rozhovor:\n\n{text}"
    else:
        system = "Jsi asistent pro sumarizaci rozhovorů. Vytvoř stručné shrnutí tohoto úseku rozhovoru v češtině (2-4 věty)."
        prompt = f"Shrň tento úsek rozhovoru:\n\n{text}"

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        max_tokens=1024,
    )
    return response.choices[0].message.content
