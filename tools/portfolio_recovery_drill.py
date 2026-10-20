#!/usr/bin/env python3
"""Exercise an explicitly isolated recovery target, never the live project.

This writes test records to the target, with Telegram requests intercepted by the
separately deployed recovery adapter. It cannot send a real Telegram message.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import sys
import uuid
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from portfolio_full_recovery import open_kit, read_key, private_write, recovery_test_function
from portfolio_restore import validate_target


def request(base: str, key: str, path: str, *, token: str | None = None, body=None, method=None, headers=None):
    values = {"apikey": key, "Authorization": "Bearer " + (token or key), "Content-Type": "application/json", **(headers or {})}
    try:
        with urlopen(Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=values),timeout=120) as response:
            raw=response.read()
            return response.status,json.loads(raw) if raw else None
    except HTTPError as error:
        result=json.loads(error.read())
        # These are test-only error codes. Never log tokens or request headers.
        return error.code,result


def prepare_functions(kit: dict, directory: Path, target: str, gate: str):
    for name, function in kit["deployed_functions"].items():
        files=recovery_test_function(function["files"],target,gate,kit["snapshot"]["portfolio"]["market_prices"])
        payload={"name":name,"project_id":target,"verify_jwt":function["verify_jwt"],"entrypoint_path":f"supabase/functions/{name}/index.ts","files":files}
        deno=f"supabase/functions/{name}/deno.json"
        if any(file["name"]==deno for file in files): payload["import_map_path"]=deno
        private_write(directory/f"deploy-{name}.json",json.dumps(payload).encode())


def exercise(kit: dict, directory: Path, target: str, key: str, password: str, gate: str, cron: str):
    validate_target(target,"1000000000")
    base=f"https://{target}.supabase.co"
    results={"project":target,"production_modified":False,"telegram_transport":"intercepted_no_real_network", "checks":{}}
    checks=results["checks"]
    sessions=[]
    for account in kit["snapshot"]["auth_users"]:
        email=f"recovery-{account['id']}@example.invalid"
        status,login=request(base,key,"/auth/v1/token?grant_type=password",body={"email":email,"password":password})
        if status!=200 or not login.get("access_token"):
            raise RuntimeError(f"Isolated password login failed ({status}): {login.get('msg',login.get('error_description','unknown'))}")
        token=login["access_token"]
        status,membership=request(base,key,"/rest/v1/app_members?select=*",token=token)
        assert status==200 and len(membership)==1 and membership[0]["user_id"]==account["id"]
        status,settings=request(base,key,"/rest/v1/portfolio_report_settings?select=user_id",token=token)
        assert status==200 and all(row["user_id"]==account["id"] for row in settings)
        sessions.append({"id":account["id"],"email":email,"token":token})
    checks["both_password_logins_and_member_scoping"]=True
    status,anon=request(base,key,"/rest/v1/portfolio_transactions?select=id")
    assert status in (401,403) or (status==200 and anon==[])
    checks["unauthenticated_financial_access_denied"]=True
    data={}
    for table in ("portfolio_transactions","manual_values","pension_values","market_prices"):
        status,rows=request(base,key,f"/rest/v1/{table}?select=*",token=sessions[0]["token"])
        assert status==200
        data[table]=rows
    if not (directory/"restored-calculations.json").exists():
        private_write(directory/"restored-calculations.json",json.dumps(data).encode())
    # Run the same domain calculator as the app against the source and restore.
    if not (directory/"original-calculations.json").exists():
        private_write(directory/"original-calculations.json",json.dumps({table:kit["snapshot"]["portfolio"][table] for table in data}).encode())
    checks["restored_data_readable_by_approved_user"]=True
    status,refresh=request(base,key,"/functions/v1/refresh-prices",token=sessions[0]["token"],body={},headers={"x-recovery-test":gate})
    if status!=200: raise RuntimeError(f"Isolated market refresh failed: {status} {refresh.get('error','unknown')}")
    assert refresh.get("recovery_external_messages")==0
    checks["recovered_market_function_with_deterministic_quotes"]=True
    # Confirm a pension update can be saved through the authenticated API.
    prior=kit["snapshot"]["portfolio"]["pension_values"][-1]
    record_id=str(uuid.uuid4())
    row={"id":record_id,"date":"2026-10-20","name":prior["name"],"value_gbp":float(prior["value_gbp"])+1,"created_by":sessions[0]["id"],"updated_by":sessions[0]["id"],"client_request_id":str(uuid.uuid4())}
    status,saved=request(base,key,"/rest/v1/pension_values",token=sessions[0]["token"],body=row,headers={"Prefer":"return=representation"})
    assert status==201 and saved[0]["id"]==record_id
    checks["pension_save_and_audit_trigger"]=True
    total_messages=0
    # 1 February 2027 is a Monday: monthly must replace, not duplicate, weekly.
    cases=[("weekly","2026-10-26T14:45:00Z"),("monthly","2027-02-01T14:45:00Z")]
    for report_type,clock in cases:
        headers={"x-recovery-test":gate,"x-recovery-clock":clock,"x-cron-secret":cron}
        status,report=request(base,key,"/functions/v1/portfolio-telegram-reports",body={"action":"run_schedule"},headers=headers)
        if status!=200: raise RuntimeError(f"Isolated {report_type} report failed: {status} {report.get('error','unknown')}")
        assert report.get("recovery_external_messages")==0 and report.get("report_type")==report_type
        assert report.get("recovery_messages_captured")==2
        total_messages+=report["recovery_messages_captured"]
        status,repeat=request(base,key,"/functions/v1/portfolio-telegram-reports",body={"action":"run_schedule"},headers=headers)
        assert status==200 and repeat.get("status")=="already_handled" and repeat.get("recovery_messages_captured")==0
        checks[f"{report_type}_report_two_captured_recipients_no_repeat"]=True
    checks["monthly_overrides_weekly_on_first_monday"]=True
    # Inspect scheduled report output without returning portfolio figures/logins.
    status,runs=request(base,key,"/rest/v1/portfolio_report_runs?period_end=eq.2027-02-01&select=report_type",token=sessions[0]["token"])
    assert status==200 and {row["report_type"] for row in runs}=={"monthly"}
    headers={"x-recovery-test":gate,"x-recovery-clock":"2026-10-26T21:45:00Z","x-cron-secret":cron}
    status,drawdown=request(base,key,"/functions/v1/portfolio-drawdown-alerts",body={"action":"run_schedule"},headers=headers)
    if status!=200: raise RuntimeError(f"Isolated alert function failed: {status} {drawdown.get('error','unknown')}")
    assert drawdown.get("recovery_external_messages")==0
    checks["after_close_alert_function_no_external_delivery"]=True
    results["captured_report_messages"]=total_messages
    results["scope_limits"]=["Real Telegram and email delivery not exercised", "Live cutover not performed", "Complete credentials archive still requires private completion"]
    private_write(directory/"drill-result.json",json.dumps(results,indent=2).encode())
    private_write(directory/"test-sessions.json",json.dumps(sessions).encode())
    print(json.dumps(results,indent=2))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=["prepare-functions","exercise"])
    parser.add_argument("--kit",type=Path,required=True)
    parser.add_argument("--key-file",type=Path,required=True)
    parser.add_argument("--target",required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--gate-file",type=Path,required=True)
    parser.add_argument("--publishable-key",default="")
    parser.add_argument("--password-file",type=Path)
    parser.add_argument("--cron-file",type=Path)
    args=parser.parse_args()
    validate_target(args.target,"1000000000")
    kit=open_kit(args.kit,read_key(args.key_file))
    args.output.mkdir(parents=True,exist_ok=True,mode=0o700)
    gate=args.gate_file.read_text().strip()
    if args.action=="prepare-functions": prepare_functions(kit,args.output,args.target,gate)
    else: exercise(kit,args.output,args.target,args.publishable_key,args.password_file.read_text().strip(),gate,args.cron_file.read_text().strip())


if __name__=="__main__": main()
