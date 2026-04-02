import os
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
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


@app.post("/api/segments")
async def process_segment(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    transcript_response = client.audio.transcriptions.create(
        model="whisper-1",
        file=(audio.filename, audio_bytes, audio.content_type),
        language="cs",
    )
    transcript = transcript_response.text
    summary = summarize(transcript)
    return {"transcript": transcript, "summary": summary}


class SummaryRequest(BaseModel):
    transcripts: list[str]


@app.post("/api/summary")
def get_summary(req: SummaryRequest):
    if not req.transcripts:
        return {"summary": "Zatím žádný obsah."}
    all_text = "\n\n".join(
        f"Segment {i+1}: {t}" for i, t in enumerate(req.transcripts)
    )
    return {"summary": summarize(all_text, full_session=True)}


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
