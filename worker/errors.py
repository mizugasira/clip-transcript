"""ユーザーに表示してよいエラー。message は結果画面にそのまま出る。"""
from __future__ import annotations


class UserFacingError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class FetchError(UserFacingError):
    pass


class TranscribeError(UserFacingError):
    pass
