"""Mark generation strategies."""

from gyotaku.marks.base import MarkStrategy, Path, get_strategy
from gyotaku.marks.flowfield import FlowfieldStrategy

__all__ = ["MarkStrategy", "Path", "get_strategy", "FlowfieldStrategy"]
