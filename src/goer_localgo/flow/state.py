from pydantic import BaseModel


class GoerState(BaseModel):
    user_id: str = ""
    user_message: str = ""
    response: str = ""
