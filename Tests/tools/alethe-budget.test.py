import importlib.util,sys,unittest,concurrent.futures
from pathlib import Path
spec=importlib.util.spec_from_file_location("alethe_budget",Path(__file__).resolve().parents[2]/".agents/skills/alethe/scripts/orchestrate.py")
a=importlib.util.module_from_spec(spec);sys.modules[spec.name]=a;spec.loader.exec_module(a)
class BudgetTests(unittest.TestCase):
 def test_limit_before_start(self):
  t=a.BudgetTracker({}, {"limits":{"maxCalls":1},"used":{"calls":1}})
  self.assertIsNotNone(t.admit("a")[0]);self.assertEqual(t.calls,0)
 def test_parallel_call_gate(self):
  t=a.BudgetTracker({"maxCalls":2},max_concurrent=8,workers=10)
  with concurrent.futures.ThreadPoolExecutor(8) as pool:r=list(pool.map(lambda n:t.admit(str(n))[0],range(10)))
  self.assertEqual(r.count(None),2);self.assertEqual(t.calls,2)
 def test_reported_overrun_blocks_and_is_visible(self):
  t=a.BudgetTracker({"maxReportedTokens":3});t.admit("a");t.finish("a",{"usage":{"inputTokens":4,"outputTokens":2,"cacheReadTokens":100}})
  self.assertIsNotNone(t.admit("b")[0]);self.assertEqual(t.usage()["reportedTokens"],6)
  self.assertIn("maxReportedTokens",t.usage()["exceededLimits"])
  t.finish("a",{"usage":{"totalTokens":999}});self.assertEqual(t.usage()["reportedTokens"],6)
 def test_cache_categories_are_separate(self):
  self.assertEqual(a.reported_total_tokens({"inputTokens":4,"outputTokens":2,"cacheWriteTokens":3,"cacheReadTokens":100}),9)
 def test_unknown_not_zero(self):
  t=a.BudgetTracker({"maxReportedCostUsd":1});t.finish("a",{})
  self.assertIsNone(t.usage()["reportedCostUsd"]);self.assertIsNone(t.usage()["reportedTokens"])
 def test_estimate_reserved_before_parallel_start(self):
  t=a.BudgetTracker({"maxEstimatedPromptTokens":5})
  self.assertIsNone(t.admit("a",estimated_prompt_tokens=3)[0]);self.assertIsNotNone(t.admit("b",estimated_prompt_tokens=3)[0]);self.assertEqual(t.calls,1)
 def test_outer_reported_budget_blocks(self):
  t=a.BudgetTracker({}, {"limits":{"maxReportedTokens":6},"used":{"reportedTokens":6}})
  self.assertIsNotNone(t.admit("a")[0])
 def test_wall_gate(self):
  from unittest.mock import patch
  with patch.object(a.time,"monotonic",return_value=10):t=a.BudgetTracker({"maxWallSeconds":1})
  with patch.object(a.time,"monotonic",return_value=12):
   self.assertIsNotNone(t.admit("a")[0]);self.assertIn("maxWallSeconds",t.usage()["exceededLimits"])
 def test_timeout_preserves_result(self):
  import tempfile
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory);out=path/"stdout.txt";result=path/"result.md";out.write_text("recoverable partial result")
   status,text,_,error=a.classify_result("custom","text",out,result,-1,True)
   self.assertEqual(status,"timed_out");self.assertEqual(text,"recoverable partial result");self.assertTrue(result.is_file());self.assertIsNotNone(error)
 @unittest.skipUnless(sys.platform=="win32","Windows process-tree gate")
 def test_cancel_terminates_owned_parent_and_descendant(self):
  import ctypes,subprocess,tempfile
  from ctypes import wintypes
  kernel=ctypes.WinDLL("kernel32",use_last_error=True)
  kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
  kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];kernel.TerminateProcess.argtypes=[wintypes.HANDLE,wintypes.UINT];kernel.CloseHandle.argtypes=[wintypes.HANDLE]
  with tempfile.TemporaryDirectory() as directory:
   code="import subprocess,sys,threading; p=subprocess.Popen([sys.executable,'-c','import threading;threading.Event().wait()'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print(p.pid,flush=True);threading.Event().wait()"
   process=a.start_process([sys.executable,"-c",code],Path(directory),subprocess.DEVNULL,subprocess.PIPE,subprocess.PIPE)
   handle=None
   try:
    pid=int(process.stdout.readline());handle=kernel.OpenProcess(0x100000|0x1000|1,False,pid);self.assertTrue(handle)
    registry=a.ProcessRegistry();registry.add(process);registry.stop_all()
    self.assertIsNotNone(process.poll());self.assertEqual(kernel.WaitForSingleObject(handle,2000),0)
   finally:
    a.stop_process_tree(process)
    if handle:
     if kernel.WaitForSingleObject(handle,0)!=0:kernel.TerminateProcess(handle,1);kernel.WaitForSingleObject(handle,2000)
     kernel.CloseHandle(handle)
    process.stdout.close();process.stderr.close()
if __name__=="__main__":unittest.main()
