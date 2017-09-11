import { IdentityRef } from "VSS/WebApi/Contracts";
import { getClient } from "TFS/Core/RestClient";
import { WebApiTeam } from "TFS/Core/Contracts";
import * as Q from "q";
import { CachedValue } from "../cachedValue";
import * as ExtensionCache from "./extensionCache";
import { throttlePromises } from "./throttlePromises";

interface ITeamIdentities {
    team: IdentityRef;
    members: IdentityRef[];
}
interface IProjectIdentities {
    id: string;
    name: string;
    teams: ITeamIdentities[];
}


function hardGetAllIdentitiesInTeam(project: { id: string, name: string }, team: WebApiTeam): IPromise<ITeamIdentities> {
    const teamIdentity = <IdentityRef>{ displayName: `[${project.name}]\\${team.name}`, id: team.id, isContainer: true };
    return getClient().getTeamMembers(project.id, team.id).then(members => {
        const team: ITeamIdentities = {
            team: teamIdentity,
            members,
        };
        return team;
    });
}

function hardGetAllIdentitiesInProject(project: { id: string, name: string }): IPromise<IProjectIdentities> {
    function hardGetAllIdentitiesInProjectImpl(project: { id: string, name: string }, skip: number): Q.IPromise<IProjectIdentities> {
        return getClient().getTeams(project.id, 100, skip).then(teams => {
            const teamPromises = throttlePromises(teams, t => hardGetAllIdentitiesInTeam(project, t), 10) as Q.IPromise<ITeamIdentities[]>;
            let moreTeams: Q.IPromise<IProjectIdentities | null> = Q(null);
            if (teams.length === 100) {
                moreTeams = hardGetAllIdentitiesInProjectImpl(project, skip + 100);
            }

            return Q.all([teamPromises, moreTeams]).then(([teams, moreTeams]): IProjectIdentities => ({
                id: project.id,
                name: project.name,
                teams: [...teams, ...(moreTeams ? moreTeams.teams : [])],
            }));
        });
    }
    return hardGetAllIdentitiesInProjectImpl(project, 0);
}

function hardGetAllIdentitiesInAllProjects(): IPromise<IProjectIdentities[]> {
    return getClient().getProjects().then(projects =>
        Q.all(projects.map(p => hardGetAllIdentitiesInProject(p)))
    );
}

const identities: { [key: string]: CachedValue<IdentityRef[]> } = {};
const identitiesKey = "identities";
export function getIdentities(project?: { id: string, name: string }): Q.IPromise<IdentityRef[]> {
    const key = `${identitiesKey}-${project ? project.name : ""}`;
    if (key in identities) {
        return identities[key].getValue();
    }
    function tryGetIdentities() {
        function toIdentityArr(projects: IProjectIdentities[]): IdentityRef[] {
            const idMap: { [id: string]: IdentityRef } = {};
            for (const { teams } of projects) {
                for (const {team, members} of teams) {
                    idMap[team.id] = team;
                    for(const member of members) {
                        idMap[member.id] = member;
                    }
                }
            }
            return Object.keys(idMap).map(id => idMap[id]);
        }
        return ExtensionCache.get<IProjectIdentities[]>(key).then(
            (identities): Q.IPromise<IdentityRef[]> | IdentityRef[] => {
                if (identities) {
                    return toIdentityArr(identities);
                }
                const expiration = new Date();
                expiration.setDate(expiration.getDate() + 7);
                if (project) {
                    return hardGetAllIdentitiesInProject(project).then((project): IdentityRef[] => {
                        ExtensionCache.store(key, [project]);
                        return toIdentityArr([project])
                    });
                } else {
                    return hardGetAllIdentitiesInAllProjects().then((projects) => {
                        ExtensionCache.store(key, projects);
                        return toIdentityArr(projects);
                    });
                }
            }
        );
    }
    if (!(key in identities)) {
        identities[key] = new CachedValue(tryGetIdentities);
    }
    return identities[key].getValue();
}
