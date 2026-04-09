import type { AdjacentPost, AdjacentPostResponse } from "@rin/api";
import {useEffect, useState} from "react";
import { client } from "../app/runtime";
import {timeago} from "../utils/timeago.ts";
import {Link} from "wouter";
import {useTranslation} from "react-i18next";

export function AdjacentSection({id, setError}: { id: string, setError: (error: string) => void }) {
    const [adjacentPosts, setAdjacentPosts] = useState<AdjacentPostResponse>();

    useEffect(() => {
        client.post
            .adjacent(id)
            .then(({data, error}) => {
                if (error) {
                    setError(error.value as string);
                } else if (data && typeof data !== "string") {
                    setAdjacentPosts(data);
                }
            });
    }, [id, setError]);
    return (
        <div className="bg-w  m-2 grid grid-cols-1 sm:grid-cols-2">
            <AdjacentCard data={adjacentPosts?.previousPost} type="previous"/>
            <AdjacentCard data={adjacentPosts?.nextPost} type="next"/>
        </div>
    )
}

export function AdjacentCard({data, type}: { data: AdjacentPost | null | undefined, type: "previous" | "next" }) {
    const direction = type === "previous" ? "text-start" : "text-end"
    const {t} = useTranslation()
    if (!data) {
        return (<div className="w-full p-6 duration-300">
            <p className={`t-secondary w-full ${direction}`}>
                {type === "previous" ? "Previous" : "Next"}
            </p>
            <h1 className={`text-md text-gray-700 dark:text-white text-pretty truncate ${direction}`}>
                {t('no_more')}
            </h1>
        </div>);
    }
    return (
        <Link href={`/post/${data.id}`} target="_blank"
              className={`w-full p-6 duration-300 bg-button`}>
            <p className={`t-secondary w-full ${direction}`}>
                {type === "previous" ? "Previous" : "Next"}
            </p>
            <h1 className={`text-md font-bold text-gray-700 dark:text-white text-pretty truncate ${direction}`}>
                {data.title}
            </h1>
            <p className={`space-x-2 ${direction}`}>
                <span className="text-gray-400 text-sm" title={new Date(data.createdAt).toLocaleString()}>
                    {data.createdAt === data.updatedAt ? timeago(data.createdAt) : t('post_card.published$time', {time: timeago(data.createdAt)})}
                </span>
                {data.createdAt !== data.updatedAt &&
                    <span className="text-gray-400 text-sm" title={new Date(data.updatedAt).toLocaleString()}>
                        {t('post_card.updated$time', {time: timeago(data.updatedAt)})}
                    </span>
                }
            </p>
        </Link>
    )
}
