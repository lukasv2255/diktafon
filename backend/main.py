import os
import uuid
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Security, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import openai

load_dotenv()

limiter = Limiter(key_func=get_remote_address)
app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])

API_SECRET = os.environ.get("API_SECRET")

security = HTTPBearer(auto_error=False)

# In-memory storage: {session_id: [{"transcript": str, "summary": str}]}
sessions: dict[str, list[dict]] = {}


def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    if not API_SECRET:
        return  # Auth vypnuta — lokální vývoj bez API_SECRET
    if not credentials or credentials.credentials != API_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/sessions")
@limiter.limit("20/minute")
def create_session(request: Request, _=Security(verify_token)):
    session_id = str(uuid.uuid4())
    sessions[session_id] = []
    return {"session_id": session_id}


@app.post("/segments")
@limiter.limit("60/minute")
async def process_segment(
    request: Request,
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    _=Security(verify_token),
):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    # 1. Přepis přes Whisper
    audio_bytes = await audio.read()
    transcript_response = client.audio.transcriptions.create(
        model="gpt-4o-transcribe",
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
@limiter.limit("30/minute")
def get_session_summary(session_id: str, request: Request, _=Security(verify_token)):
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
