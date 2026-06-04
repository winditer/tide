from pathlib import Path
import runpy
import sys


target = Path(__file__).with_name("lark2agent_ws.py")
sys.argv[0] = str(target)
runpy.run_path(str(target), run_name="__main__")
