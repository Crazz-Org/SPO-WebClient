/**
 * Auth Handler — extracted from StarpeaceClient.
 *
 * Handles authentication, directory login, world login, company selection,
 * company creation, server switching, and logout.
 */

import {
  WsMessageType,
  WsReqAuthCheck,
  WsReqConnectDirectory,
  WsRespConnectSuccess,
  WsReqLoginWorld,
  WsRespLoginSuccess,
  WsReqSelectCompany,
  WsReqSwitchCompany,
  WsReqCreateCompany,
  WsRespCreateCompany,
  WsReqClusterInfo,
  WsReqClusterFacilities,
  WsReqLogout,
  WsRespLogout,
  CompanyInfo,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import { useGameStore } from '../store/game-store';
import { useProfileStore } from '../store/profile-store';
import { useBuildingStore } from '../store/building-store';
import { useUiStore } from '../store/ui-store';
import type { ClientHandlerContext } from './client-context';

export async function performAuthCheck(ctx: ClientHandlerContext, username: string, password: string): Promise<void> {
  ClientBridge.setLoginLoading(true);
  ClientBridge.log('Auth', 'Checking credentials...');

  try {
    const req: WsReqAuthCheck = {
      type: WsMessageType.REQ_AUTH_CHECK,
      username,
      password,
    };
    await ctx.sendRequest(req);

    ctx.storedUsername = username;
    ctx.storedPassword = password;
    ClientBridge.setCredentials(username);
    ClientBridge.log('Auth', 'Credentials valid');
    useGameStore.getState().setLoginStage('zones');
  } catch (err: unknown) {
    ClientBridge.log('Auth', `Failed: ${toErrorMessage(err)}`);
    // `code` is a DIR_* code and the gateway already worded it; the client's own
    // getErrorMessage() would re-word it from the wrong table (issue 532).
    const { code = 0, serverMessage } = err as { code?: number; serverMessage?: string };
    ClientBridge.setAuthError({ code, message: serverMessage || toErrorMessage(err) });
  } finally {
    ClientBridge.setLoginLoading(false);
  }
}

export async function performDirectoryLogin(ctx: ClientHandlerContext, username: string, password: string, zonePath?: string): Promise<void> {
  ctx.storedUsername = username;
  ctx.storedPassword = password;
  ClientBridge.setCredentials(username);
  const zoneDisplay = zonePath?.split('/').pop() || 'BETA';
  ClientBridge.log('Directory', `Authenticating for ${zoneDisplay}...`);

  try {
    const req: WsReqConnectDirectory = {
      type: WsMessageType.REQ_CONNECT_DIRECTORY,
      username,
      password,
      zonePath
    };

    const resp = (await ctx.sendRequest(req)) as WsRespConnectSuccess;
    ClientBridge.log('Directory', `Authentication Success. Found ${resp.worlds.length} world(s) in ${zoneDisplay}.`);
    ClientBridge.showWorlds(resp.worlds);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Directory Auth Failed: ${toErrorMessage(err)}`);
    ClientBridge.showError('Login Failed: ' + toErrorMessage(err));
    ClientBridge.setLoginLoading(false);
  }
}

export async function login(ctx: ClientHandlerContext, worldName: string): Promise<void> {
  if (!ctx.storedUsername || !ctx.storedPassword) {
    ClientBridge.showError('Session lost, please reconnect');
    return;
  }

  ClientBridge.log('Login', `Joining world ${worldName}...`);
  ctx.currentWorldName = worldName;

  try {
    const req: WsReqLoginWorld = {
      type: WsMessageType.REQ_LOGIN_WORLD,
      username: ctx.storedUsername,
      password: ctx.storedPassword,
      worldName
    };
    const resp = (await ctx.sendRequest(req)) as WsRespLoginSuccess;
    ClientBridge.log('Login', `Success! Tycoon: ${resp.tycoonId}`);
    // The requester half of `grantAccess`. Voyager's ClientView.getSecurityId is
    // exactly this id (`ServerCnxHandler.pas:2524-2527`); without it every civic
    // control falls back to "holds office somewhere", which is not a permission.
    ClientBridge.setCredentials(ctx.storedUsername, resp.tycoonId);

    if (resp.worldXSize !== undefined) ctx.worldXSize = resp.worldXSize;
    if (resp.worldYSize !== undefined) ctx.worldYSize = resp.worldYSize;
    if (resp.worldSeason !== undefined) ctx.worldSeason = resp.worldSeason;

    if (resp.loginPage) {
      ClientBridge.log('Login', resp.loginPage.kind === 'denied'
        ? `Login denied: access expired on ${resp.loginPage.expiresOn}`
        : `Login page reported error: ${resp.loginPage.errorCode}`);
      ctx.availableCompanies = [];
      ClientBridge.showLoginPage(resp.loginPage);
      return;
    }

    ctx.availableCompanies = resp.companies ?? [];
    if (ctx.availableCompanies.length > 0) {
      ClientBridge.log('Login', `Found ${ctx.availableCompanies.length} compan${ctx.availableCompanies.length > 1 ? 'ies' : 'y'}`);
    } else {
      ClientBridge.log('Login', 'No companies found — showing company creation');
    }
    ClientBridge.showCompanies(ctx.availableCompanies);

  } catch (err: unknown) {
    ClientBridge.log('Error', `Login failed: ${toErrorMessage(err)}`);
    ClientBridge.setLoginLoading(false);
    ctx.showNotification(`World login failed: ${toErrorMessage(err)}`, 'error');
  }
}

export async function selectCompanyAndStart(ctx: ClientHandlerContext, companyId: string): Promise<void> {
  if (ctx.isSelectingCompany) return;

  ctx.isSelectingCompany = true;
  ClientBridge.log('Company', `Selecting company ID: ${companyId}...`);

  try {
    const company = ctx.availableCompanies.find(c => c.id === companyId);
    if (!company) throw new Error('Company not found');

    const needsSwitch = company.ownerRole && company.ownerRole !== ctx.storedUsername;

    if (needsSwitch) {
      ClientBridge.log('Company', `Switching to role-based company: ${company.name} (${company.ownerRole})...`);

      const req: WsReqSwitchCompany = {
        type: WsMessageType.REQ_SWITCH_COMPANY,
        company: company
      };

      const switchResp = await ctx.sendRequest(req);
      ClientBridge.log('Company', 'Company switch successful');

      const switchRespAny = switchResp as unknown as Record<string, unknown>;
      if (typeof switchRespAny.playerX === 'number' && typeof switchRespAny.playerY === 'number'
          && (switchRespAny.playerX !== 0 || switchRespAny.playerY !== 0)) {
        ctx.savedPlayerX = switchRespAny.playerX;
        ctx.savedPlayerY = switchRespAny.playerY;
        ClientBridge.log('Map', `Restoring camera to saved position (${ctx.savedPlayerX}, ${ctx.savedPlayerY})`);
      }
    } else {
      const req: WsReqSelectCompany = {
        type: WsMessageType.REQ_SELECT_COMPANY,
        companyId
      };

      const selectResp = await ctx.sendRequest(req);
      ClientBridge.log('Company', 'Company selected successfully');

      const respAny = selectResp as unknown as Record<string, unknown>;
      if (typeof respAny.playerX === 'number' && typeof respAny.playerY === 'number'
          && (respAny.playerX !== 0 || respAny.playerY !== 0)) {
        ctx.savedPlayerX = respAny.playerX;
        ctx.savedPlayerY = respAny.playerY;
        ClientBridge.log('Map', `Restoring camera to saved position (${ctx.savedPlayerX}, ${ctx.savedPlayerY})`);
      }
    }

    ctx.currentCompanyName = company.name;

    const roleRaw = company.ownerRole ?? '';
    const roleLower = roleRaw.toLowerCase();
    const isPublicOffice = roleLower.includes('president') || roleLower.includes('minister') || roleLower.includes('mayor');
    ClientBridge.setPublicOfficeRole(isPublicOffice, roleRaw);

    if (ctx.storedUsername) {
      ctx.sendMessage({ type: WsMessageType.REQ_TYCOON_ROLE, tycoonName: ctx.storedUsername });
    }

    // Signal map loading start — overlay appears before GameScreen transitions in
    ClientBridge.setMapLoadingProgress({ active: true, progress: 0, message: 'Loading game data...' });

    // Transition to connected so GameScreen renders (MapLoadingScreen overlays it)
    ClientBridge.setConnected();
    ClientBridge.setWorld(ctx.currentWorldName);
    ClientBridge.setCompany(company.name, company.id);

    if (useGameStore.getState().serverSwitchMode) {
      useGameStore.getState().completeServerSwitch();
    }

    // Fire-and-forget safe: connectMailService + getProfile use sendMessage (no timeout)
    ctx.connectMailService().catch((err: unknown) => {
      ClientBridge.log('Mail', `Mail service connection failed: ${toErrorMessage(err)}`);
    });
    ctx.getProfile().catch((err: unknown) => {
      ClientBridge.log('Profile', `Profile fetch failed: ${toErrorMessage(err)}`);
    });

    // Parallel: facility dimensions + terrain load are independent — run concurrently
    await Promise.all([
      ctx.preloadFacilityDimensions().then(() => {
        ClientBridge.setMapLoadingProgress({ progress: 0.3, message: 'Building data ready...' });
      }),
      ctx.switchToGameView().then(() => {
        ClientBridge.setMapLoadingProgress({ progress: 0.9, message: 'Entering world...' });
      }),
    ]);

    if (ctx.worldSeason !== null) {
      const renderer = ctx.getRenderer();
      if (renderer) {
        renderer.setSeason(ctx.worldSeason as import('../../shared/map-config').Season);
      }
    }

    if (ctx.savedPlayerX !== undefined && ctx.savedPlayerY !== undefined) {
      const renderer = ctx.getRenderer();
      if (renderer) {
        renderer.centerOn(ctx.savedPlayerX, ctx.savedPlayerY);
      }
    }

    // Wait for visible viewport chunks to load before dismissing the overlay.
    // This prevents the user seeing an empty/blue canvas while chunks stream in.
    const rendererForChunks = ctx.getRenderer();
    if (rendererForChunks) {
      const zoomLevel = 2; // Default zoom on login
      const visibleChunks = rendererForChunks.getVisibleChunkCoords(zoomLevel);
      const chunkCache = rendererForChunks.getChunkCache();
      if (chunkCache && visibleChunks.length > 0) {
        const chunkTotal = visibleChunks.length;
        ClientBridge.setMapLoadingProgress({
          progress: 0.95,
          message: `Loading terrain: 0/${chunkTotal} chunks`,
        });
        await chunkCache.awaitChunksReady(visibleChunks, zoomLevel, 15_000, (done: number, total: number) => {
          const pct = 0.95 + (total > 0 ? (done / total) * 0.04 : 0);
          ClientBridge.setMapLoadingProgress({
            progress: pct,
            message: `Loading terrain: ${done}/${total} chunks`,
          });
        });
      }
    }

    // Chat init runs AFTER terrain + facility dims are loaded.
    // initChatChannels() makes 3 sequential sendRequest() calls internally — launching
    // it concurrently with preloadFacilityDimensions() overwhelmed the RDO connection
    // and caused timeouts.  Fire-and-forget here so it doesn't block the overlay dismiss.
    ctx.initChatChannels().catch((err: unknown) => {
      ClientBridge.log('Chat', `Chat init failed: ${toErrorMessage(err)}`);
    });

    // Map is fully ready — dismiss the loading overlay
    ClientBridge.setMapLoadingProgress({ active: false, progress: 1, message: '' });

  } catch (err: unknown) {
    ClientBridge.log('Error', `Company selection failed: ${toErrorMessage(err)}`);
    ClientBridge.setLoginLoading(false);
    ctx.showNotification(`Company selection failed: ${toErrorMessage(err)}`, 'error');
  } finally {
    ctx.isSelectingCompany = false;
  }
}

export async function handleCreateCompany(ctx: ClientHandlerContext, companyName: string, cluster: string): Promise<void> {
  const req: WsReqCreateCompany = {
    type: WsMessageType.REQ_CREATE_COMPANY,
    companyName,
    cluster,
  };

  const resp = await ctx.sendRequest(req) as WsRespCreateCompany;
  ClientBridge.log('Company', `Company created: "${resp.companyName}" (ID: ${resp.companyId})`);
  ctx.showNotification(`Company "${resp.companyName}" created!`, 'success');
  ctx.soundManager.play('notification');

  const newCompany: CompanyInfo = {
    id: resp.companyId,
    name: resp.companyName,
    ownerRole: ctx.storedUsername,
  };
  ctx.availableCompanies.push(newCompany);

  if (ctx.getMapNavigationUI()) {
    // Full company switch so the server re-authenticates with the new
    // company's context (worldContextId, interfaceServerId, selectCompany)
    await profileSwitchCompany(ctx, resp.companyId, resp.companyName, newCompany.ownerRole ?? '');
    return;
  }

  await selectCompanyAndStart(ctx, resp.companyId);
}

export function requestClusterInfo(ctx: ClientHandlerContext, clusterName: string): void {
  useGameStore.getState().setClusterInfoLoading(true);
  const req: WsReqClusterInfo = {
    type: WsMessageType.REQ_CLUSTER_INFO,
    clusterName,
  };
  ctx.rawSend(req);
}

export function requestClusterFacilities(ctx: ClientHandlerContext, cluster: string, folder: string): void {
  useGameStore.getState().setClusterFacilitiesLoading(true);
  const req: WsReqClusterFacilities = {
    type: WsMessageType.REQ_CLUSTER_FACILITIES,
    cluster,
    folder,
  };
  ctx.rawSend(req);
}

export function startServerSwitch(): void {
  useGameStore.getState().enterServerSwitch();
}

export function cancelServerSwitch(): void {
  useGameStore.getState().cancelServerSwitch();
}

export function serverSwitchZoneSelect(ctx: ClientHandlerContext, zonePath: string): void {
  if (!ctx.storedUsername || !ctx.storedPassword) {
    ClientBridge.log('Error', 'Session lost — cannot switch server');
    useGameStore.getState().cancelServerSwitch();
    return;
  }
  performDirectoryLogin(ctx, ctx.storedUsername, ctx.storedPassword, zonePath);
}

export async function profileSwitchCompany(ctx: ClientHandlerContext, companyId: number | string, companyName: string, ownerRole: string): Promise<void> {
  const company: CompanyInfo = { id: String(companyId), name: companyName, ownerRole };
  useGameStore.getState().setSwitchingCompany(true);
  try {
    await ctx.sendRequest({
      type: WsMessageType.REQ_SWITCH_COMPANY,
      company,
    } as WsReqSwitchCompany);

    ctx.currentCompanyName = companyName;
    ClientBridge.setCompany(companyName, String(companyId));
    ClientBridge.showSuccess(`Switched to ${companyName}`);

    // Recalculate public office role for the new company
    const roleLower = ownerRole.toLowerCase();
    const isPublicOffice = roleLower.includes('president') || roleLower.includes('minister') || roleLower.includes('mayor');
    ClientBridge.setPublicOfficeRole(isPublicOffice, isPublicOffice ? ownerRole : '');

    useProfileStore.getState().reset();
    useBuildingStore.getState().clearFocus();
    useUiStore.getState().clearBuildMenuData();
  } catch (err: unknown) {
    ClientBridge.showError(`Failed to switch company: ${toErrorMessage(err)}`);
  } finally {
    useGameStore.getState().setSwitchingCompany(false);
  }
}

export async function logout(ctx: ClientHandlerContext): Promise<void> {
  if (ctx.isLoggingOut) return;

  ctx.isLoggingOut = true;
  ClientBridge.log('System', 'Logging out...');

  try {
    const req: WsReqLogout = {
      type: WsMessageType.REQ_LOGOUT
    };

    const response = await ctx.sendRequest(req) as WsRespLogout;

    if (response.success) {
      ClientBridge.log('System', 'Logged out successfully');
    } else {
      ClientBridge.log('Error', response.message || 'Logout failed');
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Logout error: ${toErrorMessage(err)}`);
  } finally {
    ctx.isLoggingOut = false;
  }
}
