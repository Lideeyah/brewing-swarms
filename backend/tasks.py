from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Optional

from backend.store import read as store_read, write as store_write

_data_dir = Path(os.getenv("DATA_DIR", str(Path(__file__).parent.parent)))
TASKS_FILE = _data_dir / "tasks.json"
STORE_KEY  = "brewing:tasks"


@dataclass
class TaskRecord:
    task_id:          str
    employer_address: str
    employer_name:    str
    description:      str
    budget_usdc:      float
    deadline_hours:   int
    status:           str           # pending | in_progress | completed | refunded
    result:           Optional[str] = None
    subtasks:         list          = field(default_factory=list)  # list of SubTask dicts
    created_at:       int           = field(default_factory=lambda: int(time.time()))
    completed_at:     Optional[int] = None


class TaskStore:
    def __init__(self):
        self._tasks: dict[str, TaskRecord] = {}
        self._load()

    def create(
        self,
        employer_address: str,
        employer_name:    str,
        description:      str,
        budget_usdc:      float,
        deadline_hours:   int,
    ) -> TaskRecord:
        task = TaskRecord(
            task_id          = str(uuid.uuid4())[:12],
            employer_address = employer_address,
            employer_name    = employer_name,
            description      = description,
            budget_usdc      = budget_usdc,
            deadline_hours   = deadline_hours,
            status           = "pending",
        )
        self._tasks[task.task_id] = task
        self._persist()
        return task

    def update(self, task: TaskRecord):
        self._tasks[task.task_id] = task
        self._persist()

    def get(self, task_id: str) -> Optional[TaskRecord]:
        return self._tasks.get(task_id)

    def all(self) -> list[TaskRecord]:
        return sorted(self._tasks.values(), key=lambda t: t.created_at, reverse=True)

    def _persist(self):
        data = {tid: asdict(t) for tid, t in self._tasks.items()}
        store_write(STORE_KEY, TASKS_FILE, data)

    def _load(self):
        try:
            data = store_read(STORE_KEY, TASKS_FILE)
            for tid, d in data.items():
                self._tasks[tid] = TaskRecord(**d)
        except Exception:
            pass


task_store = TaskStore()
