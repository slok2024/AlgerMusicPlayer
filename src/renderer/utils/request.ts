import axios, { InternalAxiosRequestConfig } from 'axios';

import { useUserStore } from '@/store/modules/user';

import { getSetData, isElectron, isMobile } from '.';

let setData: any = null;

// 扩展请求配置接口
interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  retryCount?: number;
  noRetry?: boolean;
}

/**
 * 修改点 1: 优化初始 baseURL 获取逻辑
 * 确保在 Web 环境（!window.electron）下，优先读取 VITE_API 环境变量
 * 如果环境变量也缺失，则指向你的公网 API 地址
 */
const getBaseURL = () => {
  if (window.electron) {
    // Electron 环境下，如果 setData 还没加载，暂时给个占位，拦截器里会重新修正
    return `http://127.0.0.1:${setData?.musicApiPort || 6077}`;
  }
  // Web 环境：强制使用环境变量或公网地址
  return import.meta.env.VITE_API || 'https://music.yinying.de5.net';
};

const request = axios.create({
  baseURL: getBaseURL(),
  timeout: 15000,
  withCredentials: true
});

// 最大重试次数
const MAX_RETRIES = 1;
// 重试延迟（毫秒）
const RETRY_DELAY = 500;

// 请求拦截器
request.interceptors.request.use(
  (config: CustomAxiosRequestConfig) => {
    setData = getSetData();

    /**
     * 修改点 2: 修正拦截器中的 baseURL 覆盖逻辑
     * 之前代码在这里可能因为判断不严谨导致在 Web 端也使用了本地 IP
     */
    if (window.electron && setData?.musicApiPort) {
      config.baseURL = `http://127.0.0.1:${setData.musicApiPort}`;
    } else {
      // 在浏览器 Web 端运行，强制使用公网地址，不走 127.0.0.1
      config.baseURL = import.meta.env.VITE_API || 'https://music.yinying.de5.net';
    }

    // 只在retryCount未定义时初始化为0
    if (config.retryCount === undefined) {
      config.retryCount = 0;
    }

    // 在请求发送之前做一些处理
    // 在get请求params中添加timestamp
    config.params = {
      ...config.params,
      timestamp: Date.now(),
      device: isElectron ? 'pc' : isMobile ? 'mobile' : 'web'
    };

    // 配置代理
    if (window.electron && setData) {
      const proxyConfig = setData.proxyConfig;
      if (proxyConfig && proxyConfig.enable && ['http', 'https'].includes(proxyConfig?.protocol)) {
        config.params.proxy = `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`;
      }
      if (setData.enableRealIP && setData.realIP) {
        config.params.realIP = setData.realIP;
      }
    }

    return config;
  },
  (error) => {
    // 当请求异常时做一些处理
    return Promise.reject(error);
  }
);

const NO_RETRY_URLS = ['暂时没有'];

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    console.error('error', error);
    const config = error.config as CustomAxiosRequestConfig;

    // 如果没有配置，直接返回错误
    if (!config) {
      return Promise.reject(error);
    }

    // 处理 301 状态码
    if (error.response?.status === 301 && config.params.noLogin !== true) {
      // 使用 store mutation 清除用户信息
      const userStore = useUserStore();
      userStore.handleLogout();
      console.log(`301 状态码，清除登录信息后重试第 ${config.retryCount} 次`);
      config.retryCount = 3;
    }

    // 检查是否还可以重试
    if (
      config.retryCount !== undefined &&
      config.retryCount < MAX_RETRIES &&
      !NO_RETRY_URLS.includes(config.url as string) &&
      !config.noRetry
    ) {
      config.retryCount++;
      console.log(`请求失败，正在进行第 ${config.retryCount} 次重试...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return request(config);
    }

    return Promise.reject(error);
  }
);

export default request;
