"""Uji kompatibilitas firmware main_1.cpp + frontend. Jalankan server dulu, lalu: python test_firmware.py
Peringatan: skrip ini menulis data uji ke database (event alarm, titik lokasi). Pakai database kosong/uji."""
import json, urllib.request, urllib.error
B='http://127.0.0.1:8000'
def call(m,p,body=None,h=None):
    r=urllib.request.Request(B+p,method=m,data=json.dumps(body).encode() if body is not None else None)
    r.add_header('Content-Type','application/json')
    for k,v in (h or {}).items(): r.add_header(k,v)
    try:
        with urllib.request.urlopen(r) as x: return x.status,x.read()
    except urllib.error.HTTPError as e: return e.code,e.read()
def J(m,p,body=None):
    c,b=call(m,p,body); return c,json.loads(b)
D='/api/v1/devices/sg-device-001'
print('== STATIC (200 = boleh, 404 = diblokir)')
for p in ['/','/config.js','/sw.js','/css/app.css','/js/app.js','/Backend/main.py','/Backend/smartguard.db','/package.json','/js/../Backend/main.py','/api/zzz']:
    print(' ',p, call('GET',p)[0])
print('== FIRMWARE')
c,cmd=call('GET','/api/command'); print(' command awal',c,cmd.decode())
tele=dict(mode='armed',gps_fix=True,lat=-7.7971,lng=110.3702,speed_kmh=0,satellites=8,mpu_ax=0.1,mpu_ay=0.2,mpu_az=9.8,mpu_vibration=False,battery_v=0.0,relay1=0,relay2=0,alarm_active=False,geofence_radius_m=30,dist_home_m=-1)
c,r=call('POST','/api/telemetry',tele); print(' tele normal',c)
d=J('GET',D+'/status')[1]['data']
print(' status level atas:',[k for k in ('security','gps','power','battery','report','connection','last_seen_at') if k in d],'| battery.voltage =',d['battery']['voltage_v'],'| connection =',d['connection'])
print(' home/current',J('POST',D+'/home/current')[0],'| PUT mode armed ->',J('PUT',D+'/command',{'mode':'armed','geofence_radius_m':30})[1]['data'])
al=dict(tele,alarm_active=True,lat=-7.7975,lng=110.3711,dist_home_m=46.2,battery_v=3.9)
c,r=call('POST','/api/telemetry',al); print(' tele alarm',c,'| balasan alarm_active =',json.loads(r)['alarm_active'])
call('POST','/api/telemetry',al)
c,r=call('POST','/api/telemetry',dict(al,alarm_active=False)); print(' firmware melapor alarm=false, balasan alarm_active =',json.loads(r)['alarm_active'],'(harus True = terkunci)')
ev=J('GET',D+'/events?limit=1')[1]['data']; print(' events limit=1: jumlah',len(ev['items']),'| next_cursor',ev['next_cursor'],'|',ev['items'][0]['event_type'],ev['items'][0]['reason'])
print(' semua event (alarm 2x tidak boleh ganda):',[e['event_type'] for e in J('GET',D+'/events')[1]['data']['items']])
call('POST','/api/telemetry',dict(tele,battery_v=3.4)); print(' setelah baterai 3.4 V:',[e['event_type'] for e in J('GET',D+'/events')[1]['data']['items']])
nc=J('GET',D+'/events?limit=1&cursor=1')[1]['data']; print(' cursor=1 ->',nc['items'][0]['event_type'],'| next_cursor',nc['next_cursor'])
print(' reset alarm -> alarm_active =',J('POST',D+'/alarm/reset')[1]['data']['alarm_active'])
print(' PUT mode ngawur ->',J('PUT',D+'/command',{'mode':'ngawur'})[0],'| home_lat saja ->',J('PUT',D+'/command',{'home_lat':1})[0])
print(' titik lokasi tersimpan:',len(J('GET',D+'/locations')[1]['data']['items']))
