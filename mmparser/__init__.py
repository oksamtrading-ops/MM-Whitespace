"""Workbook parsing for the Mining Whitespace Intelligence Tool.

Named `mmparser` rather than `parser` (as docs/design/14-delivery-plan.md has it)
because `parser` shadows a stdlib module on Python 3.9, this project's interpreter.
"""
__all__ = ["textnorm", "aliases", "sentinels", "safety", "sheets", "workbook", "report"]
