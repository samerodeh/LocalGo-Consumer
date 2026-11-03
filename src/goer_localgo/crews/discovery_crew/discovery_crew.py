from crewai import Agent, Crew, Process, Task
from crewai.agents.agent_builder.base_agent import BaseAgent
from crewai.project import CrewBase, agent, crew, task

from goer_localgo.tools.catalog_tools import GetMenuTool, SearchMenuTool


@CrewBase
class DiscoveryCrew:
    agents: list[BaseAgent]
    tasks: list[Task]

    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    @agent
    def discovery_agent(self) -> Agent:
        return Agent(
            config=self.agents_config["discovery_agent"],  # type: ignore[index]
            tools=[SearchMenuTool(), GetMenuTool()],
            allow_delegation=False,
            verbose=False,
        )

    @task
    def discovery_task(self) -> Task:
        return Task(
            config=self.tasks_config["discovery_task"],  # type: ignore[index]
        )

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=False,
        )
