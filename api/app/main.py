from __future__ import annotations

import json
import os
import threading
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.agents import (
    ApprovalRequest,
    ExplanationRequest,
    GradeRequest,
    GoalRequest,
    Learner,
    _APPROVALS,
    _APPROVAL_LOCK,
    check_input,
    decide_search,
    explain,
    grade_quiz,
    history,
    initialize_db,
    learner_stats,
    lookup_term,
    propose_search,
    record_event,
    set_daily_goal,
    use_streak_freeze,
)

app = FastAPI(title="Termloop API", version="0.1.0", description="A school-safe AI term explainer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("TERMLOOP_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.on_event("startup")
def on_startup() -> None:
    initialize_db()


def http_error(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, ValueError):
        return HTTPException(status_code=400, detail=str(error))
    return HTTPException(status_code=502, detail="The tutor could not complete that request. Please try again.")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/glossary")
def get_glossary(q: str = "") -> list[dict[str, str]]:
    return lookup_term(q) if q else lookup_term("AI")[:5]


@app.post("/api/search-approval")
def request_search_approval(body: ApprovalRequest) -> dict[str, str]:
    try:
        check_input(body.query)
        token = propose_search(body.learner_id, body.query)
        return {"approval_token": token, "message": "An adult needs to approve this web search before it runs."}
    except Exception as error:
        raise http_error(error) from error


@app.post("/api/search-approval/{token}/decision")
def search_decision(token: str, approved: bool, learner_id: str = "guest") -> dict[str, Any]:
    try:
        return {"approved": decide_search(learner_id, token, approved)}
    except Exception as error:
        raise http_error(error) from error


def event(name: str, data: Any) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/api/explain/stream")
def explain_stream(body: ExplanationRequest, request: Request) -> StreamingResponse:
    try:
        check_input(body.term)
        if not lookup_term(body.term) and not body.approval_token:
            raise LookupError("I couldn’t find that in the AI glossary. Request an adult-approved search to continue.")
        web_text = ""
        if body.approval_token:
            with _APPROVAL_LOCK:
                approval = _APPROVALS.get(body.approval_token)
                if not approval or approval["learner_id"] != body.learner_id or approval["status"] != "approved":
                    raise ValueError("An adult must approve this exact search before the search can run.")
                web_query = approval["query"]
                del _APPROVALS[body.approval_token]
            from app.agents import _web_search
            web_text = _web_search(web_query)
        from app.agents import check_rate_limit
        check_rate_limit(body.learner_id)
    except Exception as error:
        raise http_error(error) from error

    def generate():
        try:
            from app.agents import _explain_sync
            from concurrent.futures import ThreadPoolExecutor
            from app.agents import lookup_term
            pool = ThreadPoolExecutor(max_workers=1)
            future = pool.submit(_explain_sync, body.term, lookup_term(body.term), None, web_text)
            yield event("status", {"message": "Checking the glossary and planning a clear explanation…"})
            while not future.done():
                if request.is_disconnected():
                    future.cancel()
                    pool.shutdown(wait=False, cancel_futures=True)
                    return
                import time
                time.sleep(0.15)
                yield event("status", {"message": "Building your simple explanation, model, example, and quiz…"})
            explanation = future.result()
            payload = explanation.model_dump()
            yield event("explanation", payload)
            stats = record_event(body.learner_id, body.term, "explanation")
            yield event("stats", stats)
            yield event("done", {"ok": True})
            pool.shutdown(wait=False)
        except Exception as error:
            yield event("error", {"detail": "The tutor could not complete that request safely. Please try again."})

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/explain")
def explain_term(body: ExplanationRequest) -> dict[str, Any]:
    try:
        result = explain(body.term, body.learner_id)
        stats = record_event(body.learner_id, body.term, "explanation")
        return {"explanation": result.model_dump(), "stats": stats}
    except Exception as error:
        raise http_error(error) from error


@app.post("/api/quiz/grade")
def quiz_grade(body: GradeRequest) -> dict[str, Any]:
    try:
        grade = grade_quiz(body.term, body.answer, body.expected, body.learner_id)
        stats = record_event(body.learner_id, body.term, "quiz", grade.score, grade.feedback)
        return {"grade": grade.model_dump(), "stats": stats}
    except Exception as error:
        raise http_error(error) from error


@app.get("/api/stats/{learner_id}")
def stats(learner_id: str) -> dict[str, Any]:
    from app.agents import engine
    with Session(engine) as session:
        return learner_stats(session.get(Learner, learner_id))


@app.get("/api/history/{learner_id}")
def learner_history(learner_id: str) -> list[dict[str, Any]]:
    from app.agents import engine
    return history(learner_id)


@app.post("/api/goal")
def update_goal(body: GoalRequest) -> dict[str, Any]:
    return set_daily_goal(body.learner_id, body.daily_goal)


@app.post("/api/streak-freeze/{learner_id}")
def streak_freeze(learner_id: str) -> dict[str, Any]:
    try:
        return use_streak_freeze(learner_id)
    except Exception as error:
        raise http_error(error) from error
