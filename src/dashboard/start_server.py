import subprocess
import time
import os

print("Starting server without stdout capture...")
proc = subprocess.Popen(["python", "-m", "http.server", "8088"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("Server started with PID:", proc.pid)

try:
    while True:
        time.sleep(10)
except KeyboardInterrupt:
    proc.terminate()
