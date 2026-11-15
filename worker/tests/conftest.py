import sys
from pathlib import Path

# worker/ 直下のモジュール（config, db, ...）を import できるようにする
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
