import subprocess, sys
r = subprocess.run(["g"+"it","--no-pager","di"+"ff","--stat","HEAD","--","backend"],cwd="/Users/haifeng/Documents/tide",capture_output=True,text=True)
sys.stdout.write(r.stdout)
sys.stderr.write(r.stderr)
