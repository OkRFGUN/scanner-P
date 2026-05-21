import random
import time
import json
import csv
from typing import List, Dict, Optional
from dataclasses import dataclass
import redis
import ddddocr
from curl_cffi import requests
from fake_useragent import UserAgent
from bs4 import BeautifulSoup
import pandas as pd
from playwright.sync_api import sync_playwright

# ====================== 全局配置区 ======================
TARGET_URL = "https://xxx.com"
CRAWL_FIELDS = ["标题","内容","链接"]
EXPORT_MODE = "csv"
# IP池配置
USE_IP_POOL = True
REDIS_IP_KEY = "proxy_pool"
REDIS_HOST = "127.0.0.1"
REDIS_PORT = 6379
# 指纹与请求配置
IMPERSONATE_FINGER = "chrome128"
MIN_SLEEP = 1.2
MAX_SLEEP = 3.5
# 验证码识别器初始化
ocr = ddddocr.DdddOcr()

# ====================== IP池管理模块 ======================
class ProxyPool:
    def __init__(self):
        self.redis_cli = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0, decode_responses=True)

    def get_random_proxy(self) -> Optional[str]:
        if not USE_IP_POOL:
            return None
        proxy_list = self.redis_cli.lrange(REDIS_IP_KEY, 0, -1)
        if not proxy_list:
            return None
        return random.choice(proxy_list)

    def del_invalid_proxy(self, proxy):
        self.redis_cli.lrem(REDIS_IP_KEY, 0, proxy)

# ====================== 多层指纹&反检测头 ======================
ua = UserAgent()
SEC_HEADERS = [
    {"sec-ch-ua":'"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
     "sec-ch-ua-mobile":"?0","sec-ch-ua-platform":"Windows"},
    {"sec-ch-ua":'"Safari";v="17", "AppleWebKit";v="605"',
     "sec-ch-ua-mobile":"?0","sec-ch-ua-platform":"macOS"}
]

def get_anti_detect_headers():
    sec_info = random.choice(SEC_HEADERS)
    headers = {
        "User-Agent": ua.random,
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":"zh-CN,zh;q=0.9",
        "Accept-Encoding":"gzip, deflate, br",
        "Connection":"keep-alive",
        "Upgrade-Insecure-Requests":"1",
        "DNT":"1",**sec_info
    }
    return headers

# ====================== 验证码破解模块 ======================
def crack_img_code(img_bytes) -> str:
    try:
        res = ocr.classification(img_bytes)
        return res
    except:
        return ""

# ====================== Playwright深度反检测脚本 ======================
def get_hide_browser_context(play):
    browser = play.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox","--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage","--window-size=1280,720"
        ]
    )
    context = browser.new_context(
        user_agent=ua.random,
        viewport={"width":1280,"height":720},
        locale="zh-CN"
    )
    # 注入反检测JS
    hide_js = """
    Object.defineProperty(navigator, 'webdriver', {get: () => false});
    Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3]});
    window.chrome = {runtime:{}};
    """
    context.add_init_script(hide_js)
    return browser, context

# ====================== 核心爬虫引擎 ======================
class FullAntiCrawl:
    def __init__(self):
        self.proxy_pool = ProxyPool()
        self.session = requests.Session()
        self.data_store = []

    def random_sleep(self):
        time.sleep(random.uniform(MIN_SLEEP, MAX_SLEEP))

    def normal_request(self, url):
        self.random_sleep()
        headers = get_anti_detect_headers()
        proxy = self.proxy_pool.get_random_proxy()
        proxies = {"http":proxy,"https":proxy} if proxy else None
        try:
            resp = self.session.get(
                url,headers=headers,proxies=proxies,
                impersonate=IMPERSONATE_FINGER,timeout=18,verify=False
            )
            resp.raise_for_status()
            return resp.text, resp.content
        except Exception as e:
            if proxy:
                self.proxy_pool.del_invalid_proxy(proxy)
            print(f"常规请求异常：{e}")
            return None, None

    def js_render_request(self, url):
        self.random_sleep()
        with sync_playwright() as play:
            browser, ctx = get_hide_browser_context(play)
            page = ctx.new_page()
            proxy = self.proxy_pool.get_random_proxy()
            if proxy:
                page.set_extra_http_proxy(proxy)
            try:
                page.goto(url,timeout=30000,wait_until="networkidle")
                html = page.content()
                return html
            except Exception as e:
                print(f"渲染请求异常：{e}")
                return None
            finally:
                browser.close()

    def parse_custom_data(self, html):
        soup = BeautifulSoup(html,"html.parser")
        res_list = []
        # 自定义解析规则，按需修改选择器
        items = soup.find_all("div",class_="item")
        for item in items:
            title = item.find("h3")
            link = item.find("a",href=True)
            content = item.find("p")
            data = {
                "标题":title.get_text(strip=True) if title else "",
                "内容":content.get_text(strip=True) if content else "",
                "链接":link["href"] if link else ""
            }
            res_list.append(data)
        return res_list

    def save_export(self):
        if not self.data_store:
            print("无抓取数据")
            return
        name = f"crawl_result_{int(time.time())}"
        if EXPORT_MODE == "json":
            with open(f"{name}.json","w",encoding="utf-8") as f:
                json.dump(self.data_store,f,ensure_ascii=False,indent=2)
        elif EXPORT_MODE == "csv":
            with open(f"{name}.csv","w",encoding="utf-8-sig",newline="") as f:
                w = csv.DictWriter(f,fieldnames=CRAWL_FIELDS)
                w.writeheader()
                w.writerows(self.data_store)
        elif EXPORT_MODE == "excel":
            pd.DataFrame(self.data_store).to_excel(f"{name}.xlsx",index=False)
        print(f"数据导出完成：{name}")

    def run_crawl(self, target_url, use_render=False):
        print("启动全防护规避爬虫")
        if use_render:
            page_html = self.js_render_request(target_url)
        else:
            page_html,_ = self.normal_request(target_url)
        if not page_html:
            return
        self.data_store = self.parse_custom_data(page_html)
        print(f"成功抓取{len(self.data_store)}条数据")
        self.save_export()

# ====================== 启动入口 ======================
if __name__ == "__main__":
    crawler = FullAntiCrawl()
    # use_render=True 开启JS渲染+深度反检测，False走指纹请求
    crawler.run_crawl(TARGET_URL, use_render=False)