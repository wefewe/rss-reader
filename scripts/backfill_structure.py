#!/usr/bin/env python3
"""
CLI wrapper for WO-20261024-11 backfill script.
"""
import os
import sys

# Add backend directory to sys.path
backend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.scripts.backfill_structure import main

if __name__ == "__main__":
    main()
